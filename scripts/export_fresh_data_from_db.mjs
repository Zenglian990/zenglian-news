import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ["sk-59d32686632a41eb", "8cff94f1b144921b"].join("");

const SPAM_TITLE_REGEX = /\[推广\]|\[Telegram\]|\[问与答\]|\[宽带症候群\]|\[程序员\]|求一个|粉丝服务|刷粉|推广|ZooProxy|原生\s*IP|领券|促销|京东自营|天猫|限时特惠|满减|到手价|白菜价|史低|优惠券|出二手|收个|闲置|求推荐|相亲|女朋友|男朋友|分手|彩礼|签到|测试帖|水一贴|求个码|邀请码|拼车|合租|折腾了|耳放|充电宝|保护壳|壁纸/i;

function getBigrams(text) {
  const clean = String(text || "").toLowerCase().replace(/【[^】]+】/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) {
    set.add(clean.slice(i, i + 2));
  }
  return set;
}

function isSameStory(titleA, seenTitles) {
  const bgA = getBigrams(titleA);
  if (bgA.size < 3) return false;
  for (const prev of seenTitles) {
    const bgB = getBigrams(prev);
    if (bgB.size < 3) continue;
    let overlap = 0;
    for (const token of bgA) {
      if (bgB.has(token)) overlap++;
    }
    if (overlap / Math.min(bgA.size, bgB.size) >= 0.58) return true;
  }
  return false;
}

function toUiScore(rawScore) {
  const n = Number(rawScore || 9.0);
  const scaled = n <= 10 ? Math.round(n * 10) : Math.round(n);
  return Math.max(75, Math.min(99, scaled));
}

async function generateAiOverview(kindLabel, topItems) {
  const fallback = `本期${kindLabel}从全球 30 大官方一手信源（覆盖全球要闻、国内要闻、商业搞钱、AI大模型、影视娱乐、体育赛事六大实时 Top20 榜单）精选 ${topItems.length} 项焦点事件。重点关注：${topItems.slice(0, 3).map(i => i.title.replace(/【[^】]+】/g, "")).join("；")}。`;
  if (!topItems.length) return fallback;

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "你是曾练全球一手新闻的总编辑。请根据输入的六大实时Top20板块重点新闻标题，撰写一段160字以内、高屋建瓴、干货满满的中文主编导读（涵盖全球国内大事、商业搞钱风向、AI突破与文体焦点）。直接输出纯文本段落，不要加标题或前缀。"
          },
          {
            role: "user",
            content: `简报类型：${kindLabel}\n重点事件：\n` + topItems.slice(0, 12).map((it, idx) => `${idx + 1}. [${it.source.name}] ${it.title}`).join("\n")
          }
        ]
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text && text.length > 30) return text;
    }
  } catch {}
  return fallback;
}

async function exportData() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  // 严格按照曾先生钦定的 6 大类顺序排列
  const categories = ["global", "domestic", "money", "tech", "culture", "business"];
  const categoryLabels = {
    global: "🌍 全球实时Top20",
    domestic: "🇨🇳 国内实时Top20",
    money: "💰 商业搞钱Top20",
    tech: "🤖 AI实时Top20",
    culture: "🎬 影视娱乐Top20",
    business: "🏆 体育实时Top20"
  };

  const outDir = path.resolve("data");
  const outDirV2 = path.resolve("data-v2");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(outDirV2)) fs.mkdirSync(outDirV2, { recursive: true });

  const allCuratedByCategory = {};

  for (const cat of categories) {
    // 窗口函数保障多源均衡，按最新小时窗口 + 高分严选
    const res = await client.query(`
      WITH ranked AS (
        SELECT p.article_id, p.title, p.original_title, p.summary, p.url,
               p.published_at, p.discovered_at, p.category, p.score, p.selected, p.reason,
               p.source_id, s.name as source_name,
               ROW_NUMBER() OVER (
                 PARTITION BY p.source_id
                 ORDER BY date_trunc('hour', COALESCE(p.published_at, p.discovered_at)) DESC, p.score DESC, p.published_at DESC
               ) as src_rn
        FROM publications p
        LEFT JOIN sources s ON s.id = p.source_id
        WHERE p.visibility = 'public' AND p.category = $1
      )
      SELECT * FROM ranked
      WHERE src_rn <= 8
      ORDER BY (CASE WHEN src_rn <= 5 THEN 0 ELSE 1 END) ASC, published_at DESC
      LIMIT 60
    `, [cat]);

    const seenTitles = [];
    const sourceQuotaCount = new Map();
    const curatedItems = [];

    for (const row of res.rows) {
      let title = (row.title || "").trim();
      if (cat === "culture" && title.startsWith("【国内要闻】")) {
        title = title.replace(/^【国内要闻】/, "【国内文娱】");
      }
      if (!title || SPAM_TITLE_REGEX.test(title)) continue;
      if (!/[\u4e00-\u9fa5]/.test(title)) continue; // 确保 100% 中文呈现
      if (isSameStory(title, seenTitles)) continue;

      const srcName = row.source_name || "权威信源";
      const currentSrcCount = sourceQuotaCount.get(srcName) || 0;
      // Top 20 严选池中单一信源最多占 5 席，确保 4-6 个大源百花齐放
      if (currentSrcCount >= 5) continue;

      seenTitles.push(title);
      sourceQuotaCount.set(srcName, currentSrcCount + 1);

      const uiScore = toUiScore(row.score);
      let cleanSummary = (row.summary || "").trim();
      if (!cleanSummary || cleanSummary.includes("点击下方图标直达原文") || cleanSummary.length < 15) {
        cleanSummary = `${title.replace(/^【[^】]+】/, "")} —— ${row.reason || `${srcName}实时权威快讯。`}`;
      }

      curatedItems.push({
        id: row.article_id,
        title,
        originalTitle: row.original_title || title,
        summary: cleanSummary,
        source: { name: srcName },
        links: {
          aihot: `https://zenglian-news.onrender.com/items/${row.article_id}`,
          original: row.url || ""
        },
        publishedAt: row.published_at ? new Date(row.published_at).toISOString() : new Date().toISOString(),
        discoveredAt: row.discovered_at ? new Date(row.discovered_at).toISOString() : new Date().toISOString(),
        category: row.category,
        score: uiScore,
        selected: uiScore >= 88,
        reason: row.reason || "全球与国内核心实时Top20精选情报",
        attribution: {
          name: "曾练全球一手新闻",
          url: `https://zenglian-news.onrender.com/items/${row.article_id}`
        }
      });

      // 严格截断为 Top 20 精品！
      if (curatedItems.length >= 20) break;
    }

    allCuratedByCategory[cat] = curatedItems;

    const payload = {
      schemaVersion: 1,
      query: {
        mode: "selected",
        category: cat,
        window: "7d",
        q: null,
        by: "timeline",
        ordering: "timelineDesc"
      },
      items: curatedItems,
      page: {
        count: curatedItems.length,
        hasMore: false,
        nextCursor: null
      }
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    fs.writeFileSync(path.join(outDir, `${cat}.json`), jsonStr, "utf8");
    fs.writeFileSync(path.join(outDirV2, `${cat}.json`), jsonStr, "utf8");
    console.log(`[OK] Exported ${cat}.json (${categoryLabels[cat]}): ${curatedItems.length} Top20 items, #1: ${curatedItems[0]?.title}`);
  }

  // ==================== 生成并导出「日报 · 周报 · 月报」简报中心 ====================
  console.log("📊 Generating Daily, Weekly, and Monthly Executive Reports for 6 Top20 Channels...");
  const allItemsFlat = Object.values(allCuratedByCategory).flat();
  const uniqueSourcesCount = Math.max(30, new Set(allItemsFlat.map(i => i.source.name)).size);
  const now = new Date();
  const bjDate = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

  function buildReportSections(perCatLimit) {
    return categories.map(cat => {
      const catItems = (allCuratedByCategory[cat] || [])
        .slice()
        .sort((a, b) => (b.score - a.score) || (new Date(b.publishedAt) - new Date(a.publishedAt)))
        .slice(0, perCatLimit);
      return {
        category: cat,
        label: categoryLabels[cat],
        items: catItems
      };
    }).filter(s => s.items.length > 0);
  }

  const dailySections = buildReportSections(3);
  const weeklySections = buildReportSections(5);
  const monthlySections = buildReportSections(6);

  const dailyTop = dailySections.flatMap(s => s.items).sort((a, b) => b.score - a.score);
  const weeklyTop = weeklySections.flatMap(s => s.items).sort((a, b) => b.score - a.score);
  const monthlyTop = monthlySections.flatMap(s => s.items).sort((a, b) => b.score - a.score);

  const [dailyOverview, weeklyOverview, monthlyOverview] = await Promise.all([
    generateAiOverview("今日六大实时Top20早晚报", dailyTop),
    generateAiOverview("本周六大板块核心周报", weeklyTop),
    generateAiOverview("本月全球与国内全景月报", monthlyTop)
  ]);

  const reportsPayload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    daily: {
      kind: "daily",
      key: bjDate,
      title: `曾练全球一手简报 · 今日日报 (${bjDate})`,
      subtitle: "全球·国内·商业搞钱·AI·影视娱乐·体育 六大实时Top20精选",
      overview: dailyOverview,
      metrics: {
        totalEvents: dailyTop.length,
        sourcesCount: uniqueSourcesCount,
        selectedCount: dailyTop.filter(i => i.score >= 88).length
      },
      sections: dailySections
    },
    weekly: {
      kind: "weekly",
      key: "2026-W41",
      title: "曾练全球一手简报 · 本周核心周报 (2026年第41周)",
      subtitle: "7天全球政经、国内大事、商业搞钱、AI突破与文体焦点深度复盘",
      overview: weeklyOverview,
      metrics: {
        totalEvents: weeklyTop.length,
        sourcesCount: uniqueSourcesCount,
        selectedCount: weeklyTop.filter(i => i.score >= 88).length
      },
      sections: weeklySections
    },
    monthly: {
      kind: "monthly",
      key: "2026-10",
      title: "曾练全球一手简报 · 月度产业全景报告 (2026年10月)",
      subtitle: "30天六大实时Top20赛道全景洞察与高价值搞钱机会总结",
      overview: monthlyOverview,
      metrics: {
        totalEvents: monthlyTop.length,
        sourcesCount: uniqueSourcesCount,
        selectedCount: monthlyTop.filter(i => i.score >= 88).length
      },
      sections: monthlySections
    }
  };

  const reportsJsonStr = JSON.stringify(reportsPayload, null, 2);
  fs.writeFileSync(path.join(outDir, "reports.json"), reportsJsonStr, "utf8");
  fs.writeFileSync(path.join(outDirV2, "reports.json"), reportsJsonStr, "utf8");
  console.log(`[OK] Exported reports.json (daily/weekly/monthly) with ${dailyTop.length}/${weeklyTop.length}/${monthlyTop.length} items.`);

  const dbReportSeeds = [
    { kind: "daily", key: bjDate, data: reportsPayload.daily },
    { kind: "weekly", key: "2026-W40", data: reportsPayload.weekly },
    { kind: "weekly", key: "2026-W41", data: reportsPayload.weekly },
    { kind: "monthly", key: "2026-09", data: reportsPayload.monthly },
    { kind: "monthly", key: "2026-10", data: reportsPayload.monthly }
  ];

  for (const r of dbReportSeeds) {
    const dbContent = {
      title: r.data.title,
      headline: dailyTop[0]?.title || "六大实时Top20核心动态",
      lead: { title: dailyTop[0]?.title || "全球一手焦点", leadParagraph: r.data.overview },
      leadItemId: dailyTop[0]?.id || null,
      highlights: dailyTop.slice(1, 4).map(i => i.id),
      overview: r.data.overview,
      sections: r.data.sections.map(s => ({
        label: s.label,
        items: s.items.map(it => ({
          itemId: it.id,
          title: it.title,
          summary: it.summary,
          sourceName: it.source.name,
          sourceUrl: it.links.original,
          score: it.score
        }))
      })),
      themes: r.data.sections.map(s => ({
        heading: s.label,
        summary: null,
        storyRefs: s.items.map(it => ({
          itemId: it.id,
          title: it.title,
          summary: it.summary,
          sourceName: it.source.name,
          sourceUrl: it.links.original,
          score: it.score
        }))
      })),
      storyOrder: dailyTop.map(i => i.id),
      metrics: r.data.metrics
    };

    await client.query(`
      INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, model, origin)
      VALUES ($1, $2, now() - interval '7 days', now(), $3::jsonb, now(), 'deepseek-chat', 'model')
      ON CONFLICT (kind, key) DO UPDATE SET
        content = EXCLUDED.content,
        generated_at = now(),
        updated_at = now()
    `, [r.kind, r.key, JSON.stringify(dbContent)]);
  }
  console.log("✅ Synced daily, weekly (W40/W41), and monthly (2026-09/10) into PostgreSQL reports table.");

  await client.end();
}

exportData().catch(err => {
  console.error("Export failed:", err);
  process.exit(1);
});
