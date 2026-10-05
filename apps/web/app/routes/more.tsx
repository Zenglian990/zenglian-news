import { useEffect, useState, type ReactNode } from "react";
import { Link, useLoaderData, useRouteLoaderData } from "react-router";
import { POLICY, SITE } from "@aihot/site";
import type { TimelineResponse } from "@aihot/contracts/site";
import type { loader as rootLoader } from "../root";
import { useChangelogDot } from "../components/shell/Sidebar";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { apiGet, edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { useStarred } from "../lib/local-state";
import { ThemeSwitch } from "../components/shell/ThemeSwitch";
import { Sheet } from "../components/ui/Sheet";
import {
  IconBookmark,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternal,
  IconGrid,
  IconHeart,
  IconMessage,
  IconMoon,
  IconPlug,
  IconShield,
  IconSparkles,
} from "../components/icons";

export const handle: Screen = { tab: "me", name: "我的" };

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({ title: "我的", path: "/more", noindex: true });
}

export async function loader({ request }: { request: Request }) {
  const data = await apiGet<TimelineResponse>("/api/site/timeline?limit=8", { signal: request.signal }).catch(() => null);
  const items = (data?.cards ?? []).slice(0, 6).map((c) => ({
    id: c.item.id,
    title: c.item.title,
    summary: c.item.summary,
    source: c.item.source?.name ?? "权威信源",
    category: c.item.category,
    itemUrl: `/items/${c.item.id}`,
  }));
  return { items };
}

type Row = { to: string; label: string; icon: ReactNode; detail?: ReactNode };

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h2 className="px-4 pb-2 pt-6 text-[13px] font-semibold text-ink-3">{title}</h2>}
      <ul className="card divide-y divide-line-soft overflow-hidden">{children}</ul>
    </section>
  );
}

function RowLink({ row, dot = false }: { row: Row; dot?: boolean }) {
  return (
    <li>
      <Link viewTransition to={row.to} className="flex min-h-[52px] items-center gap-3 px-4 text-[16px] font-medium text-ink transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk">
        <span className="text-ink-3">{row.icon}</span>
        <span className="flex flex-1 items-center gap-2">
          {row.label}
          {dot && <span className="size-[7px] rounded-full bg-hot" aria-label="有新的更新" />}
        </span>
        {row.detail && <span className="text-[14px] font-normal text-ink-4">{row.detail}</span>}
        <IconChevronRight size={16} className="text-ink-4" />
      </Link>
    </li>
  );
}

export default function MorePage() {
  const { items } = useLoaderData<typeof loader>();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const changelogDot = useChangelogDot(root?.changelogVersion ?? null);
  const starred = useStarred();
  const [here, setHere] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setHere(true), []);

  const todayStr = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());

  const morningBriefText = [
    `☀️【曾练全球一手科技早报】`,
    `📅 ${todayStr}`,
    `━━━━━━━━━━━━━━━━━━`,
    ...items.map((item, i) => `${i + 1}. 【${item.source}】${item.title}\n   💡 核心看点：${item.summary ? item.summary.slice(0, 75) + "..." : "详见一手情报卡片"}`),
    `━━━━━━━━━━━━━━━━━━`,
    `📌 消除信息差，抢占商业先机。`,
    `📱 更多一手情报与全球商机：https://zenglian-news.onrender.com`,
  ].join("\n\n");

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(morningBriefText);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <PhoneBar title="我的" large />
      <h1 className="hidden pb-4 pt-1 text-[22px] font-bold text-ink lg:block">我的</h1>

      {/* 曾先生专属商业情报中枢 Hero Banner */}
      <div className="card mb-3 overflow-hidden border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-surface to-surface p-5 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 font-black text-xl shadow-inner">
            曾
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-bold tracking-tight text-ink">曾练商业情报中枢</h2>
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                ● 24H 智能巡航
              </span>
            </div>
            <p className="mt-1 text-[13px] text-ink-3">
              聚焦全球一手前沿科技 · 商业信息差套利 · 独立出海搞钱雷达
            </p>
          </div>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-4 2xl:grid-cols-3">
        {/* 搞钱与流量分发工具 */}
        <Group title="搞钱与流量分发工具">
          <li>
            <button
              type="button"
              onClick={() => setBriefOpen(true)}
              className="flex w-full min-h-[56px] items-center gap-3 px-4 text-left text-[16px] font-medium text-ink transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk"
            >
              <span className="text-amber-500">
                <IconSparkles size={20} />
              </span>
              <span className="flex flex-1 items-center gap-2">
                今日科技早报
                <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  一键生成复制
                </span>
              </span>
              <span className="text-[13px] text-ink-4">发群引流</span>
              <IconChevronRight size={16} className="text-ink-4" />
            </button>
          </li>
          <RowLink
            row={{
              to: "/all?category=ai-products",
              label: "全球出海与落地工具",
              icon: <IconGrid size={20} />,
              detail: "Product Hunt 首发",
            }}
          />
          <RowLink
            row={{
              to: "/agent",
              label: "Agent 自媒体自动化矩阵",
              icon: <IconPlug size={20} />,
              detail: "MCP · RSS · API",
            }}
          />
        </Group>

        {/* 信源权威保障 */}
        <Group title="信源权威与真实性保障">
          <li>
            <button
              type="button"
              onClick={() => setVerifyOpen(true)}
              className="flex w-full min-h-[52px] items-center gap-3 px-4 text-left text-[16px] font-medium text-ink transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk"
            >
              <span className="text-emerald-500">
                <IconShield size={20} />
              </span>
              <span className="flex flex-1 items-center gap-2">
                信源真实性与防伪审计
                <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  T0/T1 权威认证
                </span>
              </span>
              <IconChevronRight size={16} className="text-ink-4" />
            </button>
          </li>
          <RowLink row={{ to: "/about", label: `关于 ${SITE.name}`, icon: <IconHeart size={20} /> }} />
        </Group>

        {/* 基础设置 */}
        <Group title="系统偏好">
          <RowLink
            row={{
              to: "/starred",
              label: "我的收藏",
              icon: <IconBookmark size={20} />,
              detail: here && starred.length > 0 ? <span className="num">{starred.length}</span> : undefined,
            }}
          />
          <li className="flex min-h-[56px] items-center gap-3 px-4 text-[16px] font-medium text-ink">
            <span className="text-ink-3">
              <IconMoon size={20} />
            </span>
            <span className="flex-1">外观模式</span>
            <ThemeSwitch className="w-[126px]" />
          </li>
          <RowLink row={{ to: "/changelog", label: "更新日志", icon: <IconSparkles size={20} /> }} dot={changelogDot} />
          <RowLink row={{ to: "/feedback", label: "需求与反馈", icon: <IconMessage size={20} /> }} />
        </Group>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] leading-[2] text-ink-4">
        <Link viewTransition to="/terms" className="hover:text-ink-2">{POLICY.terms.name}</Link>
        <Link viewTransition to="/privacy" className="hover:text-ink-2">隐私说明</Link>
        <a href="/feed.xml" className="hover:text-ink-2">一手 RSS</a>
        <span className="text-ink-4">曾练商业战略资产 · 2026</span>
      </div>

      {/* 弹窗：今日早报一键复制 */}
      <Sheet open={briefOpen} onClose={() => setBriefOpen(false)} title="今日商业与科技早报">
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-ink-3">排版已优化，适合直接发送微信群、朋友圈或小红书</span>
            <button
              type="button"
              onClick={copyBrief}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-transform active:scale-95"
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? "已复制到剪贴板！" : "一键复制"}
            </button>
          </div>
          <div className="rounded-xl border border-line bg-bg-sunk p-4 text-[13.5px] leading-relaxed text-ink font-mono whitespace-pre-wrap max-h-[50vh] overflow-y-auto select-all">
            {morningBriefText}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={copyBrief}
              className="w-full rounded-xl bg-accent py-3 text-[15px] font-bold text-white transition-opacity hover:opacity-90 active:scale-[0.99]"
            >
              {copied ? "✅ 早报文案已复制，可直接发微信群！" : "复制全部文案 (一键引流)"}
            </button>
          </div>
        </div>
      </Sheet>

      {/* 弹窗：信源真实性与防伪审计 */}
      <Sheet open={verifyOpen} onClose={() => setVerifyOpen(false)} title="信源权威性与防伪审计报告">
        <div className="space-y-4 p-4 text-[14px] leading-relaxed text-ink-2 max-h-[65vh] overflow-y-auto">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-800 dark:text-emerald-200">
            <div className="flex items-center gap-2 font-bold text-[15px]">
              <IconShield size={18} />
              严格铁律：彻底拒绝营销号洗稿，只对接源头一手信息
            </div>
            <p className="mt-2 text-[13px] text-emerald-700 dark:text-emerald-300">
              【曾练全球一手新闻】系统后台设置了严格的信源白名单，彻底屏蔽百家号、企鹅号及二次拼接号，保障所读即事实。
            </p>
          </div>

          <h3 className="font-bold text-ink text-[15px]">🏛️ 已接入的 T0/T1 权威信源梯队</h3>
          <ul className="space-y-2 text-[13.5px]">
            <li className="flex items-start gap-2">
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">持牌权威</span>
              <div><strong>界面新闻</strong>：国家一类新闻采编资质，持牌财经与科技媒体，记者一线深入采写，三审三校官方级别源头。</div>
            </li>
            <li className="flex items-start gap-2">
              <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">前沿智库</span>
              <div><strong>量子位 / 极客公园</strong>：国内排名前列的 AI 垂直智库媒体，清华智谱、MiniMax、月之暗面大模型团队专访第一手首发地。</div>
            </li>
            <li className="flex items-start gap-2">
              <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-orange-600 dark:text-orange-400 shrink-0 mt-0.5">全球首发</span>
              <div><strong>Product Hunt</strong>：硅谷及全球独立开发者亲自发布产品的平台，最新出海与搞钱微工具全球第一首发地。</div>
            </li>
            <li className="flex items-start gap-2">
              <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-purple-600 dark:text-purple-400 shrink-0 mt-0.5">深度研报</span>
              <div><strong>钛媒体 / 虎嗅网</strong>：商业特稿与产业内幕深度研报，洞察商业底层逻辑，拒绝企业公关稿泡沫。</div>
            </li>
            <li className="flex items-start gap-2">
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">一手快讯</span>
              <div><strong>IT之家 / 开源中国</strong>：工信部入网公告、官方发布会实况及全球开源项目动态，极速陈述事实。</div>
            </li>
            <li className="flex items-start gap-2">
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5">独立商业</span>
              <div><strong>V2EX 搞钱创造</strong>：真实独立开发者与数字游民的出海赚钱复盘实录，真实踩坑经验分享。</div>
            </li>
          </ul>

          <h3 className="font-bold text-ink text-[15px] pt-2">🔍 100% 原文直达验证机制</h3>
          <p className="text-[13px] text-ink-3">
            每条资讯卡片均直链官方原文（点击右上角“原文”链接即可跳转原站）。若您对任何资讯存疑，可随时一键返回原媒体官方页面核验。
          </p>
        </div>
      </Sheet>
    </div>
  );
}
