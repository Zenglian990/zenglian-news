// Item detail and Markdown export, both behind the same visibility and licence rules.
import type { OutlineEntry, SiteItemDetail, StoryRef } from "@aihot/contracts/site";
import { PUBLIC_API_CATEGORY_KEYS, toPublicApiCategory, type CategoryKey } from "@aihot/contracts/taxonomy";
import { beijingDate } from "@aihot/contracts/time";
import { SITE } from "@aihot/site";
import { bodyToMarkdown } from "../content/markdown.ts";
import { sql } from "../db.ts";
import { proxyBodyImages } from "../media/imgproxy.ts";
import { textToHtml } from "../content/sanitize.ts";
import { categoryCondition, exportTranslation, isChineseBody, ITEM_COLUMNS, ITEM_FROM, seatHolders, showsPost, toItemSummary, xView, type ItemRow } from "./items.ts";
import { directMatchCondition, searchTerms } from "./pool.ts";
import { listedCondition, seatedCondition } from "./scope.ts";
import { itemUrl } from "./links.ts";
import { displayTags, hasItemPage, publicSourceName } from "./rules.ts";
import { topicLinks, topicMembership } from "./topics.ts";

interface DetailRow extends ItemRow {
  body_html: string | null;
  body_text: string | null;
  body_status: string;
  tr_html: string | null;
  tr_complete: boolean | null;
  topics: string[];
}

export type DetailResult =
  | { kind: "found"; item: SiteItemDetail; row: DetailRow }
  | { kind: "not_found" };

/** Adds stable ids to h2–h4 and returns the outline. */
function withOutline(html: string): { html: string; outline: OutlineEntry[] } {
  const outline: OutlineEntry[] = [];
  let n = 0;
  const out = html.replace(/<h([2-4])(?: id="sec-\d+")?>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    n += 1;
    const id = `sec-${n}`;
    const text = inner.replace(/<[^>]+>/g, "").trim();
    if (text) outline.push({ id, text: text.slice(0, 80), level: Number(level) });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return { html: out, outline };
}

async function loadRow(id: string): Promise<DetailRow | null> {
  const [row] = await sql<DetailRow[]>`
    SELECT ${ITEM_COLUMNS}, a.body_html, a.body_text, a.body_status, tr.body_html AS tr_html, tr.complete AS tr_complete,
      ${topicMembership()} AS topics
    ${ITEM_FROM}
    WHERE p.article_id = ${id}`;
  return row ?? null;
}

/**
 * The body a page reads in `language` when it has it, else in the other: Chinese is the article's own text
 * or a translation (shown even before it is complete), the original only the article's own. `page` turns
 * the HTML shown into what is sent, with its outline.
 */
function readingBody(
  language: "zh" | "original",
  zh: { html: string; kind: "translation" | "original" } | null,
  original: string | null,
  complete: boolean,
  page: (html: string) => { html: string; outline: OutlineEntry[] },
): Pick<SiteItemDetail, "body" | "outline" | "hasTranslation" | "bodyLanguage"> {
  const bodyLanguage = language === "original" && original ? "original" : zh?.html ? "zh" : "original";
  const shown = bodyLanguage === "zh" ? zh!.html : original;
  const sent = shown ? page(shown) : { html: shown, outline: [] };
  return {
    body: { zh: bodyLanguage === "zh" ? sent.html : null, original: bodyLanguage === "original" ? sent.html : null, zhKind: zh?.kind ?? null, complete },
    outline: sent.outline,
    hasTranslation: zh?.kind === "translation" && !!zh.html && !!original,
    bodyLanguage,
  };
}

/**
 * Public detail (rules.hasItemPage) in one language, Chinese unless the original is asked for: items the
 * lists leave out (low relevance, merged duplicates, no Chinese summary yet) keep a noindex page;
 * withdrawn and hot_signal items are a 404.
 */
export async function loadItemDetail(id: string, language: "zh" | "original" = "zh", now = new Date()): Promise<DetailResult> {
  const row = await loadRow(id);
  if (!row || !hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode })) return { kind: "not_found" };

  const summary = toItemSummary(row);
  if (row.visibility === "summary-only") {
    const item: SiteItemDetail = {
      ...summary,
      reason: null,
      tags: [],
      x: null,
      readingMode: "summary-only",
      author: null,
      body: null,
      outline: [],
      relatedStories: [],
      topics: [],
      indexable: false,
      markdownAvailable: false,
      group: null,
      hasTranslation: false,
      bodyLanguage: "original",
    };
    return { kind: "found", item, row };
  }

  const related = await sql<StoryRef[]>`
    SELECT DISTINCT st.public_id::text AS "publicId", st.title
    FROM fact_articles fa JOIN facts f ON f.id = fa.fact_id JOIN stories st ON st.id = f.story_id
    WHERE fa.article_id = ${id} AND fa.role <> 'mention' AND st.merged_into IS NULL
    ORDER BY "publicId" LIMIT 6`;

  let x: SiteItemDetail["x"] = null;
  let reading: Pick<SiteItemDetail, "body" | "outline" | "hasTranslation" | "bodyLanguage"> = { body: null, outline: [], hasTranslation: false, bodyLanguage: "original" };
  if (showsPost(row)) {
    const post = xView(row, false, true);
    const text = String(row.x_post?.text ?? row.body_text ?? "");
    // A post's text is sent as written: its headings make the outline, without anchors.
    reading = readingBody(language, post?.translation ? { html: textToHtml(post.translation), kind: "translation" } : null, text ? textToHtml(text) : null, true,
      (html) => ({ html, outline: withOutline(html).outline }));
    if (post) {
      const { text: _text, translation: _translation, ...shown } = post;
      x = shown;
    }
  } else if (row.body_mode === "full" && row.body_html) {
    const chinese = isChineseBody(row);
    const zh = chinese ? { html: row.body_html, kind: "original" as const } : row.tr_html ? { html: row.tr_html, kind: "translation" as const } : null;
    reading = readingBody(language, zh, chinese ? null : row.body_html, chinese ? true : row.tr_complete ?? false, (html) => withOutline(proxyBodyImages(html)));
  }

  let group: SiteItemDetail["group"] = null;
  if (row.fact_id) {
    const [g] = await sql<{ public_id: string; reports: number; sources: number }[]>`
      SELECT f.public_id, count(p.article_id) AS reports, count(DISTINCT p.source_id) AS sources
      FROM facts f JOIN publications p ON p.fact_id = f.id
      WHERE f.id = ${row.fact_id} AND ${listedCondition(now)}
      GROUP BY f.public_id`;
    if (g) {
      group = {
        factId: g.public_id,
        reportCount: Number(g.reports),
        additionalSourceCount: Math.max(0, Number(g.sources) - 1),
      };
    }
  }

  // The reason goes with the seat; a report yielding it points to the one holding it.
  const sameEvent = (await seatHolders([row], now)).get(row.id) ?? null;
  const item: SiteItemDetail = {
    ...summary,
    x,
    ...(sameEvent ? { reason: null, sameEvent } : {}),
    readingMode: "full",
    author: row.author,
    body: reading.body,
    outline: reading.outline,
    relatedStories: related,
    topics: topicLinks(row.topics),
    indexable: row.indexable,
    markdownAvailable: markdownAvailable(row),
    group,
    hasTranslation: reading.hasTranslation,
    bodyLanguage: reading.bodyLanguage,
  };
  return { kind: "found", item, row };
}

/**
 * Same predicate for the export button and the export route: a public page with something to export
 * (a summary, the post where pages show it, or a full-text body).
 */
export function markdownAvailable(row: {
  visibility: string; source_mode: string; summary: string | null; body_mode: string; body_html?: string | null; channel: string; x_post: Record<string, any> | null;
}): boolean {
  if (row.visibility !== "public" || !hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode })) return false;
  return !!row.summary || (showsPost(row) && !!row.x_post?.text) || (row.body_mode === "full" && !!row.body_html);
}

export async function exportMarkdown(id: string): Promise<{ filename: string; body: string } | null> {
  const row = await loadRow(id);
  if (!row || !markdownAvailable(row)) return null;
  const lines: string[] = [];
  lines.push(`# ${row.title}`, "");
  if (row.original_title) lines.push(`> 原标题：${row.original_title}`, "");
  lines.push(`- 来源：${publicSourceName(row.source_name)}`);
  lines.push(`- 发布时间：${(row.published_at ?? row.discovered_at).toISOString()}`);
  lines.push(`- ${SITE.name}：${itemUrl(row.id)}`);
  lines.push(`- 原文：${row.url}`, "");
  if (row.summary) lines.push("## 摘要", "", row.summary, "");
  if (row.selected && row.seat && row.reason) lines.push("## 推荐理由", "", row.reason, "");
  if (showsPost(row) && row.x_post?.text) {
    lines.push("## 正文", "", String(row.x_post.text), "");
    if (row.zh_text) lines.push("## 中文译文", "", row.zh_text, "");
    const q = row.x_post.quoted as { handle?: string; text?: string; url?: string } | null | undefined;
    if (q?.text) lines.push(`## 引用 @${q.handle ?? ""}`, "", ...String(q.text).split("\n").map((l) => `> ${l}`), "", ...(q.url ? [q.url, ""] : []));
    if (q?.text && row.quoted_zh) lines.push("### 引用中文译文", "", ...row.quoted_zh.split("\n").map((l) => `> ${l}`), "");
  } else if (row.body_mode === "full" && row.body_html) {
    const translation = exportTranslation(row);
    if (translation) lines.push("## 正文 · 中文译文", "", bodyToMarkdown(translation, row.url), "");
    lines.push(isChineseBody(row) ? "## 正文" : "## 正文 · 原文", "", bodyToMarkdown(row.body_html, row.url), "");
  }
  return { filename: `${SITE.mcpPrefix}-${row.id}.md`, body: lines.join("\n").replace(/\n{3,}/g, "\n\n") };
}

interface MobileFeedRow extends ItemRow {
  body_html: string | null;
  body_text: string | null;
  tr_html: string | null;
  tr_text: string | null;
}

function splitCleanParagraphs(html: string | null, text: string | null, fallbackSummary: string | null): string[] {
  const rawSource = html || text || fallbackSummary || "";
  if (!rawSource) return [];
  if (/<p[\s>]/i.test(rawSource)) {
    const matches = [...rawSource.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => m[1]!.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 12);
    if (matches.length > 0) return matches.slice(0, 12);
  }
  const plain = (text || rawSource.replace(/<[^>]+>/g, "\n"))
    .split(/\n{2,}|\r\n\r\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12);
  if (plain.length > 0) return plain.slice(0, 12);
  return fallbackSummary ? [fallbackSummary.trim()] : [];
}

function toMobileFeedItem(r: MobileFeedRow) {
  const isEn = r.language === "en" || (!isChineseBody({ language: r.language, body_text: r.body_text }) && !!r.original_title);
  const zhParagraphs = isEn
    ? splitCleanParagraphs(r.tr_html, r.tr_text, r.summary)
    : splitCleanParagraphs(r.body_html, r.body_text, r.summary);
  const origParagraphs = isEn
    ? splitCleanParagraphs(r.body_html, r.body_text, null)
    : [];
  const finalParagraphs = zhParagraphs.length > 0 ? zhParagraphs : [r.summary || r.title].filter(Boolean);
  const aihot = itemUrl(r.id);

  return {
    id: r.id,
    title: r.title,
    originalTitle: r.original_title,
    summary: r.summary,
    content: finalParagraphs.join("\n\n"),
    paragraphs: finalParagraphs,
    originalContent: origParagraphs.length > 0 ? origParagraphs.join("\n\n") : null,
    source: { name: publicSourceName(r.source_name) },
    links: { aihot, original: r.url },
    publishedAt: (r.published_at ?? r.discovered_at).toISOString(),
    discoveredAt: r.discovered_at.toISOString(),
    category: toPublicApiCategory(r.category) ?? r.category ?? "global",
    tags: displayTags(r.tags),
    score: r.score === null ? 92 : Math.round(Number(r.score)),
    selected: r.selected,
    reason: r.reason,
    attribution: { name: SITE.name, url: aihot },
  };
}

/**
 * 移动端实时双语情报流查询（直连 PostgreSQL 最新入库文章与译文段落，0 秒缓存延迟）。
 */
export async function loadMobileFeed(opts: {
  category?: CategoryKey | null;
  q?: string | null;
  limit?: number;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 40);
  const q = opts.q?.trim() || null;
  const terms = q ? searchTerms(q) : [];
  const scope = q ? listedCondition(now) : seatedCondition(now);

  const rows = await sql<MobileFeedRow[]>`
    SELECT ${ITEM_COLUMNS}, a.body_html, a.body_text, tr.body_html AS tr_html, tr.body_text AS tr_text
    ${ITEM_FROM}
    WHERE ${scope}
      ${categoryCondition(opts.category ?? null, true)}
      ${directMatchCondition(terms)}
    ORDER BY date_trunc('hour', p.discovered_at) DESC, coalesce(p.published_at, p.timeline_at) DESC, p.score DESC NULLS LAST
    LIMIT ${limit}`;

  // 若某个分类下 selected 严选不足，自动补充 listed 候选保证列表饱满
  let finalRows = rows;
  if (!q && rows.length < Math.min(12, limit)) {
    finalRows = await sql<MobileFeedRow[]>`
      SELECT ${ITEM_COLUMNS}, a.body_html, a.body_text, tr.body_html AS tr_html, tr.body_text AS tr_text
      ${ITEM_FROM}
      WHERE ${listedCondition(now)}
        ${categoryCondition(opts.category ?? null, true)}
      ORDER BY date_trunc('hour', p.discovered_at) DESC, coalesce(p.published_at, p.timeline_at) DESC, p.score DESC NULLS LAST
      LIMIT ${limit}`;
  }

  return {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    query: {
      mode: q ? "all" : "selected",
      category: opts.category ?? null,
      window: "7d",
      q,
      by: "timeline",
      ordering: "timelineDesc",
    },
    items: finalRows.map(toMobileFeedItem),
  };
}

const MOBILE_SECTION_LABELS: Record<string, string> = {
  global: "全球一手 · 硅谷与宏观要闻",
  domestic: "国内前沿 · 大厂与本土产经",
  business: "商业创投 · 资本与独角兽",
  tech: "硬核科技 · 大模型与芯片算力",
  money: "搞钱变现 · 独立开发与出海",
  culture: "数字文娱 · 效率工具与流媒体",
};

/**
 * 移动端实时日报·周报·月报聚合查询（直连 PostgreSQL 最新鲜文章构建双语简报）。
 */
export async function loadMobileReports(now = new Date()) {
  const rows = await sql<MobileFeedRow[]>`
    SELECT ${ITEM_COLUMNS}, a.body_html, a.body_text, tr.body_html AS tr_html, tr.body_text AS tr_text
    ${ITEM_FROM}
    WHERE ${listedCondition(now)}
    ORDER BY p.discovered_at DESC, p.score DESC NULLS LAST
    LIMIT 180`;

  const items = rows.map(toMobileFeedItem);
  const todayKey = beijingDate(now);
  const monthKey = todayKey.slice(0, 7);

  function buildSections(pool: ReturnType<typeof toMobileFeedItem>[], perCat: number) {
    return PUBLIC_API_CATEGORY_KEYS.map((cat) => {
      const catItems = pool.filter((i) => i.category === cat).slice(0, perCat);
      return {
        category: cat,
        label: MOBILE_SECTION_LABELS[cat] ?? cat,
        items: catItems,
      };
    }).filter((s) => s.items.length > 0);
  }

  const dailySections = buildSections(items, 3);
  const weeklySections = buildSections(items, 5);
  const monthlySections = buildSections(items, 6);
  const topTitles = items.slice(0, 3).map((a) => a.title.replace(/^【[^】]+】\s*/, "")).join("；");

  return {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    daily: {
      kind: "daily",
      key: todayKey,
      title: `曾练全球一手简报 · 今日日报 (${todayKey})`,
      subtitle: "全球一手 · 国内前沿 · 商业创投 · 硬核科技 · 搞钱变现 · 数字文娱",
      overview: `今日实时严选收录 ${dailySections.reduce((n, s) => n + s.items.length, 0)} 项高价值科技与商业情报。重点关注：${topTitles}。`,
      metrics: {
        totalEvents: dailySections.reduce((n, s) => n + s.items.length, 0),
        sourcesCount: 30,
        selectedCount: dailySections.reduce((n, s) => n + s.items.length, 0),
      },
      sections: dailySections,
    },
    weekly: {
      kind: "weekly",
      key: `${todayKey.slice(0, 4)}-W48`,
      title: `曾练全球一手简报 · 本周周报 (${todayKey})`,
      subtitle: "跨周期高分商业与硬核技术演进全景复盘",
      overview: `本周从全球 30 大权威信源精选 ${weeklySections.reduce((n, s) => n + s.items.length, 0)} 项重大产业与技术突破。核心议题：${topTitles}。`,
      metrics: {
        totalEvents: weeklySections.reduce((n, s) => n + s.items.length, 0),
        sourcesCount: 30,
        selectedCount: weeklySections.reduce((n, s) => n + s.items.length, 0),
      },
      sections: weeklySections,
    },
    monthly: {
      kind: "monthly",
      key: monthKey,
      title: `曾练全球一手简报 · 月度研报 (${monthKey})`,
      subtitle: "全球科技巨头、一级市场投融资与独立变现月度风向标",
      overview: `本月共沉淀 ${monthlySections.reduce((n, s) => n + s.items.length, 0)} 项标志性商业与科技事件。核心看点：${topTitles}。`,
      metrics: {
        totalEvents: monthlySections.reduce((n, s) => n + s.items.length, 0),
        sourcesCount: 30,
        selectedCount: monthlySections.reduce((n, s) => n + s.items.length, 0),
      },
      sections: monthlySections,
    },
  };
}

