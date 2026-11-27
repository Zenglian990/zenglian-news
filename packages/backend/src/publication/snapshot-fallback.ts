// Zero-503 live snapshot fallback layer: when PostgreSQL (e.g. Neon free tier) is unavailable
// or quota-limited, public read APIs seamlessly serve fresh curated snapshots kept up-to-date
// on disk by AutoCurator (data-v2/*.json) and mirrored from GitHub CDN.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type {
  FeedItemSummary,
  HotResponse,
  ItemAvailability,
  PoolResponse,
  ReportCitation,
  ReportDetail,
  ReportIndexEntry,
  ReportKind,
  SiteItemDetail,
  SiteStats,
  TimelineResponse,
  TopicPage,
  TopicsResponse,
} from "@aihot/contracts/site";
import { CATEGORY_KEYS, PUBLIC_API_CATEGORY_KEYS, type CategoryKey, type ChannelKey, type PublicApiCategoryKey } from "@aihot/contracts/taxonomy";
import { beijingDate } from "@aihot/contracts/time";
import { SITE, withSubject } from "@aihot/site";
import { config, REPO_ROOT } from "../config.ts";
import { v1Payload } from "./publish.ts";
import type { V1ItemsResult } from "./v1.ts";
import { TOPIC_GROUPS, TOPICS, findTopic } from "./topics.ts";

export interface SnapshotItem {
  id: string;
  title: string;
  originalTitle: string | null;
  summary: string | null;
  content: string;
  paragraphs: string[];
  originalContent: string | null;
  source: { name: string };
  links: { aihot: string; original: string };
  publishedAt: string;
  discoveredAt: string;
  category: CategoryKey;
  tags: string[];
  score: number;
  selected: boolean;
  reason: string | null;
  attribution: { name: typeof SITE.name; url: string };
}

interface SnapshotFeedFile {
  schemaVersion?: number;
  generatedAt?: string;
  items?: SnapshotItem[];
}

export interface SnapshotReportSection {
  category: PublicApiCategoryKey;
  label: string;
  items: SnapshotItem[];
}

export interface SnapshotReportIssue {
  kind: ReportKind;
  key: string;
  title: string;
  subtitle: string;
  overview: string;
  metrics: { totalEvents: number; sourcesCount: number; selectedCount: number };
  sections: SnapshotReportSection[];
}

export interface SnapshotReportsFile {
  schemaVersion: 1;
  generatedAt: string;
  daily: SnapshotReportIssue;
  weekly: SnapshotReportIssue;
  monthly: SnapshotReportIssue;
}

// ---------------------------------------------------------------------------
// DB circuit breaker (avoids burning 10s timeouts per request when DB is down)
// ---------------------------------------------------------------------------

const DB_COOLDOWN_MS = 60_000;
let dbDownUntil = 0;
let lastDbError = "";

export function isDbQuotaOrConnectivityError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = String((err as { message?: unknown }).message ?? err).toLowerCase();
  const code = String((err as { code?: unknown }).code ?? "").toUpperCase();
  if (
    msg.includes("exceeded the quota") ||
    msg.includes("upgrade your plan") ||
    msg.includes("timeout exceeded") ||
    msg.includes("connect_timeout") ||
    msg.includes("connection terminated") ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("too many connections") ||
    msg.includes("remaining connection slots")
  ) {
    return true;
  }
  return code === "08000" || code === "08001" || code === "08003" || code === "08006" || code === "53300" || code === "57P01" || code === "CONNECT_TIMEOUT";
}

export function markDbDegraded(err: unknown): void {
  dbDownUntil = Date.now() + DB_COOLDOWN_MS;
  lastDbError = String((err as { message?: unknown })?.message ?? err).slice(0, 200);
}

export function markDbHealthy(): void {
  dbDownUntil = 0;
  lastDbError = "";
}

export function isDbDegraded(): boolean {
  return Date.now() < dbDownUntil;
}

export function dbDegradedReason(): string {
  return lastDbError;
}

export async function withDbFallback<T>(dbFn: () => Promise<T>, fallbackFn: () => Promise<T> | T): Promise<T> {
  if (isDbDegraded()) {
    return await fallbackFn();
  }
  try {
    const result = await dbFn();
    return result;
  } catch (err) {
    if (isDbQuotaOrConnectivityError(err)) {
      markDbDegraded(err);
      return await fallbackFn();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Live snapshot store (watches local data-v2/*.json + optional GitHub refresh)
// ---------------------------------------------------------------------------

const SNAPSHOT_DIRS = [path.join(REPO_ROOT, "data-v2"), path.join(REPO_ROOT, "data")];
const REMOTE_BASES = [
  "https://raw.githubusercontent.com/Zenglian990/zenglian-news/main/data-v2",
  "https://cdn.jsdelivr.net/gh/Zenglian990/zenglian-news@main/data-v2",
];

interface LoadedStore {
  loadedAt: number;
  newestMtime: number;
  generatedAt: string;
  byCategory: Map<CategoryKey, SnapshotItem[]>;
  allItems: SnapshotItem[];
  byId: Map<string, SnapshotItem>;
  reports: SnapshotReportsFile | null;
}

let cachedStore: LoadedStore | null = null;
let remoteRefreshInFlight: Promise<void> | null = null;
let lastRemoteRefreshAt = 0;

function resolveSnapshotDir(): string {
  for (const d of SNAPSHOT_DIRS) {
    if (existsSync(path.join(d, "global.json"))) return d;
  }
  return SNAPSHOT_DIRS[0]!;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToSafeHtml(text: string | null, paragraphs?: string[]): string | null {
  const list = paragraphs && paragraphs.length > 0
    ? paragraphs
    : (text ? text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) : []);
  if (list.length === 0) return null;
  return list.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

function normalizeSnapshotItem(raw: Partial<SnapshotItem>, fallbackCategory: CategoryKey): SnapshotItem {
  const cat = (CATEGORY_KEYS as readonly string[]).includes(String(raw.category ?? ""))
    ? (raw.category as CategoryKey)
    : fallbackCategory;
  const pub = raw.publishedAt || raw.discoveredAt || new Date().toISOString();
  const disc = raw.discoveredAt || pub;
  const paragraphs = Array.isArray(raw.paragraphs) && raw.paragraphs.length > 0
    ? raw.paragraphs.map((p) => String(p))
    : (raw.content ? String(raw.content).split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) : (raw.summary ? [String(raw.summary)] : []));
  const id = String(raw.id || "");
  const aihotUrl = raw.links?.aihot || `${config.siteUrl.replace(/\/$/, "")}/items/${id}`;
  return {
    id,
    title: String(raw.title || ""),
    originalTitle: raw.originalTitle ?? null,
    summary: raw.summary ?? null,
    content: raw.content ?? (paragraphs.length ? paragraphs.join("\n\n") : String(raw.summary || raw.title || "")),
    paragraphs,
    originalContent: raw.originalContent ?? null,
    source: { name: String(raw.source?.name || "一手信源") },
    links: { aihot: aihotUrl, original: String(raw.links?.original || aihotUrl) },
    publishedAt: pub,
    discoveredAt: disc,
    category: cat,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)) : [],
    score: typeof raw.score === "number" ? (raw.score <= 10 ? Math.round(raw.score * 10) : Math.round(raw.score)) : 92,
    selected: raw.selected !== false,
    reason: raw.reason ?? null,
    attribution: { name: SITE.name, url: raw.attribution?.url || aihotUrl },
  };
}

function buildStoreFromRaw(
  byCatRaw: Map<CategoryKey, SnapshotFeedFile>,
  reports: SnapshotReportsFile | null,
  newestMtime: number,
): LoadedStore {
  const byCategory = new Map<CategoryKey, SnapshotItem[]>();
  const byId = new Map<string, SnapshotItem>();
  let generatedAt = reports?.generatedAt || new Date(newestMtime || Date.now()).toISOString();

  for (const cat of CATEGORY_KEYS) {
    const file = byCatRaw.get(cat);
    if (file?.generatedAt && file.generatedAt > generatedAt) {
      generatedAt = file.generatedAt;
    }
    const list = (file?.items ?? [])
      .map((it) => normalizeSnapshotItem(it, cat))
      .filter((it) => it.id && it.title);
    list.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.score - a.score);
    byCategory.set(cat, list);
    for (const it of list) {
      if (!byId.has(it.id)) byId.set(it.id, it);
    }
  }

  const allItems = [...byId.values()].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.score - a.score,
  );

  return {
    loadedAt: Date.now(),
    newestMtime,
    generatedAt,
    byCategory,
    allItems,
    byId,
    reports,
  };
}

function readLocalSnapshots(): LoadedStore {
  const dir = resolveSnapshotDir();
  let newestMtime = 0;
  for (const cat of CATEGORY_KEYS) {
    const f = path.join(dir, `${cat}.json`);
    if (existsSync(f)) {
      const m = statSync(f).mtimeMs;
      if (m > newestMtime) newestMtime = m;
    }
  }
  const repPath = path.join(dir, "reports.json");
  if (existsSync(repPath)) {
    const m = statSync(repPath).mtimeMs;
    if (m > newestMtime) newestMtime = m;
  }

  if (cachedStore && cachedStore.newestMtime >= newestMtime && Date.now() - cachedStore.loadedAt < 30_000) {
    return cachedStore;
  }

  const byCatRaw = new Map<CategoryKey, SnapshotFeedFile>();
  for (const cat of CATEGORY_KEYS) {
    const f = path.join(dir, `${cat}.json`);
    if (!existsSync(f)) continue;
    try {
      byCatRaw.set(cat, JSON.parse(readFileSync(f, "utf8")) as SnapshotFeedFile);
    } catch {
      // ignore malformed file
    }
  }

  let reports: SnapshotReportsFile | null = null;
  if (existsSync(repPath)) {
    try {
      reports = JSON.parse(readFileSync(repPath, "utf8")) as SnapshotReportsFile;
    } catch {
      reports = null;
    }
  }

  cachedStore = buildStoreFromRaw(byCatRaw, reports, newestMtime);
  return cachedStore;
}

async function maybeRefreshRemoteSnapshots(store: LoadedStore): Promise<LoadedStore> {
  const ageMs = Date.now() - Date.parse(store.generatedAt || "");
  const needRemote = (!store.allItems.length || Number.isNaN(ageMs) || ageMs > 20 * 60_000) && Date.now() - lastRemoteRefreshAt > 10 * 60_000;
  if (!needRemote) return store;

  if (!remoteRefreshInFlight) {
    lastRemoteRefreshAt = Date.now();
    remoteRefreshInFlight = (async () => {
      for (const base of REMOTE_BASES) {
        try {
          const ts = Math.floor(Date.now() / 60_000);
          const entries = await Promise.all(
            CATEGORY_KEYS.map(async (cat) => {
              const res = await fetch(`${base}/${cat}.json?_t=${ts}`, { signal: AbortSignal.timeout(5000) });
              if (!res.ok) return [cat, null] as const;
              return [cat, (await res.json()) as SnapshotFeedFile] as const;
            }),
          );
          const byCatRaw = new Map<CategoryKey, SnapshotFeedFile>();
          for (const [cat, data] of entries) {
            if (data?.items?.length) byCatRaw.set(cat, data);
          }
          if (byCatRaw.size === 0) continue;

          let reports: SnapshotReportsFile | null = store.reports;
          try {
            const repRes = await fetch(`${base}/reports.json?_t=${ts}`, { signal: AbortSignal.timeout(5000) });
            if (repRes.ok) reports = (await repRes.json()) as SnapshotReportsFile;
          } catch {
            // keep local reports
          }

          const remoteStore = buildStoreFromRaw(byCatRaw, reports, Math.max(store.newestMtime, Date.now()));
          if (Date.parse(remoteStore.generatedAt) >= Date.parse(store.generatedAt || "1970-01-01")) {
            cachedStore = remoteStore;
          }
          break;
        } catch {
          // try next mirror
        }
      }
    })().finally(() => {
      remoteRefreshInFlight = null;
    });
  }

  // Wait briefly on cold start only if local store is completely empty
  if (store.allItems.length === 0) {
    await remoteRefreshInFlight;
  }
  return cachedStore ?? store;
}

async function getStore(): Promise<LoadedStore> {
  const local = readLocalSnapshots();
  return maybeRefreshRemoteSnapshots(local);
}

function matchesSearch(item: SnapshotItem, q: string | null | undefined): boolean {
  if (!q || !q.trim()) return true;
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [
    item.title,
    item.originalTitle,
    item.summary,
    item.content,
    item.reason,
    item.source.name,
    ...item.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function toFeedItemSummary(it: SnapshotItem): FeedItemSummary {
  return {
    id: it.id,
    title: it.title,
    summary: it.summary,
    reason: it.reason,
    source: { name: it.source.name },
    publishedAt: it.publishedAt,
    timelineAt: it.publishedAt,
    category: it.category,
    tags: it.tags,
    score: it.score,
    selected: it.selected,
    channel: "news",
    x: null,
  };
}

// ---------------------------------------------------------------------------
// Public fallback implementations matching exact API / Site contracts
// ---------------------------------------------------------------------------

export async function fallbackMobileFeed(opts: { category?: CategoryKey | null; q?: string | null; limit?: number }) {
  const store = await getStore();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 40);
  const pool = opts.category ? (store.byCategory.get(opts.category) ?? []) : store.allItems;
  const filtered = pool.filter((it) => matchesSearch(it, opts.q)).slice(0, limit);
  return {
    schemaVersion: 1 as const,
    generatedAt: store.generatedAt,
    query: {
      mode: opts.q ? "all" : "selected",
      category: opts.category ?? null,
      window: "7d",
      q: opts.q ?? null,
      by: "timeline",
      ordering: "timelineDesc",
    },
    items: filtered,
  };
}

export async function fallbackMobileReports(): Promise<SnapshotReportsFile> {
  const store = await getStore();
  if (store.reports) return store.reports;
  const todayKey = beijingDate(new Date());
  const sections = CATEGORY_KEYS.map((cat) => ({
    category: cat,
    label: cat,
    items: (store.byCategory.get(cat) ?? []).slice(0, 3),
  })).filter((s) => s.items.length > 0);
  const makeIssue = (kind: ReportKind, key: string, title: string): SnapshotReportIssue => ({
    kind,
    key,
    title,
    subtitle: "全球一手 · 国内前沿 · 商业创投 · 硬核科技 · 搞钱变现 · 数字文娱",
    overview: `实时精选收录 ${sections.reduce((n, s) => n + s.items.length, 0)} 项全球科技与商业一手情报。`,
    metrics: { totalEvents: sections.reduce((n, s) => n + s.items.length, 0), sourcesCount: 30, selectedCount: sections.reduce((n, s) => n + s.items.length, 0) },
    sections,
  });
  return {
    schemaVersion: 1,
    generatedAt: store.generatedAt,
    daily: makeIssue("daily", todayKey, `曾练全球一手简报 · 今日日报 (${todayKey})`),
    weekly: makeIssue("weekly", `${todayKey.slice(0, 4)}-W48`, `曾练全球一手简报 · 本周周报 (${todayKey})`),
    monthly: makeIssue("monthly", todayKey.slice(0, 7), `曾练全球一手简报 · 月度研报 (${todayKey.slice(0, 7)})`),
  };
}

export async function fallbackV1Items(opts: {
  mode: "selected" | "all";
  window: "24h" | "7d";
  by: "timeline" | "published";
  category: PublicApiCategoryKey | null;
  q: string | null;
  limit: number;
}): Promise<V1ItemsResult> {
  const store = await getStore();
  const pool = opts.category ? (store.byCategory.get(opts.category as CategoryKey) ?? []) : store.allItems;
  const items = pool.filter((it) => matchesSearch(it, opts.q)).slice(0, opts.limit);
  return {
    schemaVersion: 1,
    query: {
      mode: opts.mode,
      category: opts.category,
      window: opts.window,
      q: opts.q,
      by: opts.by,
      ordering: opts.by === "published" ? "publishedAtDesc" : "timelineDesc",
    },
    items: items.map((it) =>
      v1Payload({
        articleId: it.id,
        title: it.title,
        originalTitle: it.originalTitle,
        summary: it.summary,
        sourceName: it.source.name,
        url: it.links.original,
        publishedAt: new Date(it.publishedAt),
        discoveredAt: new Date(it.discoveredAt),
        category: it.category,
        score: it.score,
        selected: it.selected,
        reason: it.reason,
      }),
    ),
    page: {
      count: items.length,
      hasMore: false,
      nextCursor: null,
    },
  };
}

export async function fallbackTimeline(opts: {
  channel: ChannelKey;
  category: CategoryKey | null;
  tag: string | null;
  limit: number;
}): Promise<TimelineResponse> {
  const store = await getStore();
  let pool = opts.category ? (store.byCategory.get(opts.category) ?? []) : store.allItems;
  if (opts.tag) {
    const tagLower = opts.tag.toLowerCase();
    pool = pool.filter((it) => it.tags.some((t) => t.toLowerCase() === tagLower));
  }
  const slice = pool.slice(0, opts.limit);
  const dayCounts: Record<string, number> = {};
  for (const it of pool) {
    const d = beijingDate(new Date(it.publishedAt));
    dayCounts[d] = (dayCounts[d] ?? 0) + 1;
  }
  return {
    filters: { channel: opts.channel, category: opts.category, tag: opts.tag },
    cards: slice.map((it) => ({
      key: `a${it.id}`,
      anchorAt: it.publishedAt,
      item: toFeedItemSummary(it),
      group: null,
    })),
    nextCursor: null,
    hot: null,
    dayCounts,
  };
}

export async function fallbackPool(opts: {
  channel: ChannelKey;
  category: CategoryKey | null;
  tag: string | null;
  q: string | null;
  tab: "time" | "relevance";
  page: number;
}): Promise<PoolResponse> {
  const store = await getStore();
  const pageSize = 20;
  let pool = opts.category ? (store.byCategory.get(opts.category) ?? []) : store.allItems;
  if (opts.tag) {
    const tagLower = opts.tag.toLowerCase();
    pool = pool.filter((it) => it.tags.some((t) => t.toLowerCase() === tagLower));
  }
  pool = pool.filter((it) => matchesSearch(it, opts.q));
  const total = pool.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(opts.page, 1), pageCount);
  const start = (safePage - 1) * pageSize;
  const today = beijingDate(new Date());
  const todayCount = pool.filter((it) => beijingDate(new Date(it.publishedAt)) === today).length;

  return {
    filters: { channel: opts.channel, category: opts.category, tag: opts.tag, q: opts.q, tab: opts.tab },
    items: pool.slice(start, start + pageSize).map(toFeedItemSummary),
    page: safePage,
    pageCount,
    total,
    todayCount,
    freshness: store.generatedAt,
  };
}

export async function fallbackItemDetail(id: string, language: "zh" | "original" = "zh"): Promise<{ kind: "found"; item: SiteItemDetail } | { kind: "not_found" }> {
  const store = await getStore();
  const it = store.byId.get(id);
  if (!it) return { kind: "not_found" };

  const zhHtml = textToSafeHtml(it.content, it.paragraphs);
  const origHtml = textToSafeHtml(it.originalContent);
  const hasTranslation = Boolean(zhHtml && origHtml && it.originalTitle);
  const activeLang: "zh" | "original" = language === "original" && origHtml ? "original" : "zh";
  const sentHtml = activeLang === "original" ? origHtml : zhHtml;

  return {
    kind: "found",
    item: {
      id: it.id,
      title: it.title,
      originalTitle: it.originalTitle,
      summary: it.summary,
      reason: it.reason,
      source: { name: it.source.name },
      links: { original: it.links.original },
      publishedAt: it.publishedAt,
      discoveredAt: it.discoveredAt,
      timelineAt: it.publishedAt,
      category: it.category,
      tags: it.tags,
      score: it.score,
      selected: it.selected,
      channel: "news",
      story: null,
      x: null,
      readingMode: sentHtml ? "full" : "summary-only",
      author: null,
      body: sentHtml
        ? {
            zh: activeLang === "zh" ? sentHtml : null,
            original: activeLang === "original" ? sentHtml : null,
            zhKind: hasTranslation ? "translation" : "original",
            complete: true,
          }
        : null,
      outline: [],
      relatedStories: [],
      topics: [],
      indexable: true,
      markdownAvailable: true,
      group: null,
      hasTranslation,
      bodyLanguage: activeLang,
    },
  };
}

export async function fallbackItemAvailability(ids: string[]): Promise<Record<string, ItemAvailability>> {
  const store = await getStore();
  const out: Record<string, ItemAvailability> = {};
  for (const id of ids) {
    const it = store.byId.get(id);
    out[id] = it ? { status: "public", sourceName: it.source.name } : { status: "unavailable" };
  }
  return out;
}

export async function fallbackHot(): Promise<HotResponse> {
  const store = await getStore();
  return { computedAt: store.generatedAt, windowHours: 48, entries: [] };
}

export async function fallbackV1HotTopics() {
  return {
    schemaVersion: 1 as const,
    count: 0,
    items: [] as Array<{
      rank: number;
      id: string;
      title: string;
      source: { name: string };
      links: { aihot: string; original: string; story: string };
      sourceCount: number;
      signalCount: number;
      participantCount: number;
      sourceNames: string[];
      latestAt: string;
    }>,
  };
}

export async function fallbackTopics(): Promise<TopicsResponse> {
  const store = await getStore();
  return {
    groups: TOPIC_GROUPS,
    topics: TOPICS.map((t) => {
      const matched = store.allItems.filter((it) => {
        const hay = `${it.title} ${it.originalTitle ?? ""} ${it.summary ?? ""} ${it.tags.join(" ")}`.toLowerCase();
        return t.aliases.some((a) => hay.includes(a.toLowerCase())) || t.tags.some((tag) => hay.includes(tag.toLowerCase()));
      });
      return {
        slug: t.slug,
        name: t.name,
        group: t.group,
        definition: t.definition,
        brand: t.group === "company" ? { src: null, monogram: t.name.slice(0, 1).toUpperCase(), raster: false } : null,
        total: matched.length,
        recent: matched.length,
        indexable: matched.length > 0,
        latest: matched[0] ? { title: matched[0].title, at: matched[0].publishedAt } : null,
      };
    }),
  };
}

export async function fallbackTopicPage(slug: string, page: number): Promise<TopicPage | null> {
  const t = findTopic(slug);
  if (!t) return null;
  const store = await getStore();
  const matched = store.allItems.filter((it) => {
    const hay = `${it.title} ${it.originalTitle ?? ""} ${it.summary ?? ""} ${it.tags.join(" ")}`.toLowerCase();
    return t.aliases.some((a) => hay.includes(a.toLowerCase())) || t.tags.some((tag) => hay.includes(tag.toLowerCase()));
  });
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const groupName = TOPIC_GROUPS.find((g) => g.key === t.group)?.name ?? t.group;
  return {
    topic: {
      slug: t.slug,
      name: t.name,
      group: t.group,
      groupName,
      definition: t.definition,
      brand: t.group === "company" ? { src: null, monogram: t.name.slice(0, 1).toUpperCase(), raster: false } : null,
      total: matched.length,
      recent: matched.length,
      poolTotal: matched.length,
      indexable: matched.length > 0,
      latest: matched[0] ? { title: matched[0].title, at: matched[0].publishedAt } : null,
    },
    modules: {},
    items: matched.slice((safePage - 1) * pageSize, safePage * pageSize).map(toFeedItemSummary),
    page: safePage,
    pageCount,
    pageSize,
  };
}

export async function fallbackSiteStats(): Promise<SiteStats> {
  const store = await getStore();
  const sources = [...new Set(store.allItems.map((i) => i.source.name))];
  return {
    sources: Math.max(30, sources.length),
    sourceKinds: { rss: Math.max(30, sources.length) },
    items: store.allItems.length,
    selected: store.allItems.filter((i) => i.selected).length,
    dailies: 50,
    day: { collected: store.allItems.length, selected: store.allItems.filter((i) => i.selected).length },
    sampleSources: sources.map((name) => ({ name, kind: "rss", heatOnly: false })),
    latest: store.allItems.slice(0, 8).map((i) => ({ id: i.id, title: i.title, source: i.source.name })),
  };
}

function toCitation(it: SnapshotItem): ReportCitation {
  return {
    itemId: it.id,
    title: it.title,
    summary: it.summary,
    sourceName: it.source.name,
    sourceUrl: it.links.original,
    sourceIconUrl: null,
    firstParty: true,
    publishedAt: it.publishedAt,
    available: true,
  };
}

export async function fallbackReportList(kind: ReportKind): Promise<ReportIndexEntry[]> {
  const rep = await fallbackMobileReports();
  const issue = rep[kind];
  const count = (issue.sections ?? []).reduce((acc, s) => acc + s.items.length, 0);
  return [{ key: issue.key, issueNumber: 1, title: issue.title, count }];
}

export async function fallbackReport(kind: ReportKind, _key?: string): Promise<ReportDetail> {
  const rep = await fallbackMobileReports();
  const issue = rep[kind];
  const sections = (issue.sections ?? []).map((s) => ({
    label: s.label,
    summary: null,
    items: s.items.map(toCitation),
  }));
  const all = sections.flatMap((s) => s.items);
  const lead = all[0] ?? null;
  return {
    kind,
    key: issue.key,
    issueNumber: 1,
    title: kind === "daily" ? `${withSubject("日报")} · ${issue.key}` : issue.title,
    generatedAt: rep.generatedAt,
    lead: lead ? { title: lead.title, leadParagraph: lead.summary ?? "" } : null,
    leadItemId: lead?.itemId ?? null,
    overview: issue.overview ?? null,
    highlights: all.slice(0, 3),
    sections,
    flashes: [],
    cover: null,
    metrics: issue.metrics ?? { sourcesCount: 30, selectedCount: all.length, firstPartyEvents: all.length },
    readingMinutes: Math.max(2, Math.round(all.length * 0.4)),
    prev: null,
    next: null,
  };
}
