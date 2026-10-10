import postgres from "postgres";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs";

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}
const sql = postgres(connStr, { ssl: "require" });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

const PREMIUM_SOURCES = [
  {
    id: "rss-qbitai",
    name: "量子位",
    feedUrl: "https://www.qbitai.com/feed",
    tags: ["科技", "AI", "智库"],
    category: "tech",
    reason: "国内最顶尖AI产业前沿，大模型落地与商业化一手洞察。"
  },
  {
    id: "rss-geekpark",
    name: "极客公园",
    feedUrl: "https://www.geekpark.net/rss",
    tags: ["科技", "创新", "商业"],
    category: "tech",
    reason: "科技商业创投与AI产品创新，聚焦创始人与商业落地。"
  },
  {
    id: "rss-huxiu",
    name: "虎嗅网",
    feedUrl: "https://rss.huxiu.com/",
    tags: ["商业", "深度", "研报"],
    category: "business",
    reason: "权威商业洞察与产业内幕，洞悉科技趋势与市场风向。"
  },
  {
    id: "rss-ifanr",
    name: "爱范儿",
    feedUrl: "https://www.ifanr.com/feed",
    tags: ["科技", "数码", "硬件"],
    category: "tech",
    reason: "爆款数码科技、AI硬件与创新消费产品一手前沿。"
  },
  {
    id: "rss-tmtpost",
    name: "钛媒体",
    feedUrl: "https://www.tmtpost.com/rss.xml",
    tags: ["商业", "资本", "创投"],
    category: "business",
    reason: "全球科技财经与资本创投动态，商业决策核心参考。"
  },
  {
    id: "rss-jiemian",
    name: "界面新闻·科技",
    feedUrl: "https://a.jiemian.com/index.php?m=article&a=rss",
    tags: ["国内", "持牌", "商业"],
    category: "domestic",
    reason: "主流商业财经媒体，实时追踪国内外科技巨头战略动向。"
  },
  {
    id: "rss-producthunt",
    name: "Product Hunt·AI落地",
    feedUrl: "https://www.producthunt.com/feed",
    tags: ["全球", "首发", "搞钱"],
    category: "global",
    reason: "全球最新AI变现神器与落地工具，独立开发与出海赚钱首选。"
  },
  {
    id: "rss-sspai",
    name: "少数派",
    feedUrl: "https://sspai.com/feed",
    tags: ["文娱", "数字生活", "工具"],
    category: "culture",
    reason: "实用效率生产力与数字生活方式，文娱生活探索指南。"
  },
  {
    id: "rss-ithome",
    name: "IT之家·一手快讯",
    feedUrl: "https://www.ithome.com/rss/",
    tags: ["国内", "一手", "快讯"],
    category: "domestic",
    reason: "科技互联网与大厂软硬件实时极速快讯，一手资讯不遗漏。"
  },
  {
    id: "rss-oschina",
    name: "开源中国",
    feedUrl: "https://www.oschina.net/news/rss",
    tags: ["国内", "开源", "生态"],
    category: "domestic",
    reason: "开源软件动态与技术前沿，掌握全球开源技术生态脉搏。"
  },
  {
    id: "rss-v2ex",
    name: "V2EX·搞钱创造",
    feedUrl: "https://www.v2ex.com/index.xml",
    tags: ["搞钱", "副业", "出海"],
    category: "money",
    reason: "独立开发者创业、副业变现与技术人灵感聚集地。"
  },
  {
    id: "rss-hackernews",
    name: "Hacker News·全球一手",
    feedUrl: "https://hnrss.org/frontpage",
    tags: ["全球", "极客", "商业"],
    category: "global",
    reason: "全球顶尖硅谷极客讨论与独立创新首发平台，洞察一手出海动向。"
  },
  {
    id: "rss-openai",
    name: "OpenAI·官方一手",
    feedUrl: "https://openai.com/news/rss.xml",
    tags: ["全球", "官方", "顶尖"],
    category: "global",
    reason: "OpenAI 官方博客与技术产品一手公告，大模型行业风向标。"
  }
];

function cleanText(raw) {
  if (!raw) return "";
  if (typeof raw === "object") {
    if (raw["#cdata"]) return cleanText(raw["#cdata"]);
    if (raw["#text"]) return cleanText(raw["#text"]);
    return "";
  }
  return String(raw).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function generateId(prefix = "a") {
  return prefix + crypto.randomBytes(12).toString("hex").slice(0, 24);
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "sk-59d32686632a41eb8cff94f1b144921b";

// DeepSeek AI Journalism Translation Engine
async function translateArticleWithDeepSeek(origTitle, origSummary, paragraphs) {
  if (!paragraphs.length && !origTitle) return null;
  const url = "https://api.deepseek.com/v1/chat/completions";
  const systemPrompt = `你是一位顶级科技与财经媒体的主编。你的任务是将英文或其他外语新闻编译为高质量、通顺地道、适合中国高端读者的简体中文新闻。
请返回纯 JSON 格式：
{
  "title": "精炼有力的中文主标题（不要包含【】标签）",
  "summary": "150字以内的核心要点速览与背景摘要",
  "paragraphs": ["段落1翻译", "段落2翻译", ...]
}`;

  const userContent = JSON.stringify({
    title: origTitle,
    summary: origSummary,
    paragraphs: paragraphs
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      const parsed = JSON.parse(content);
      if (parsed.title && /[一-鿿]/.test(parsed.title)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("  ⚠️ DeepSeek translation error:", err.message);
  }
  return null;
}

// Fallback multi-engine translator with POST and Chinese validation
async function translateToChinese(text) {
  if (!text || !text.trim()) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (/[一-鿿]/.test(clean) && !/[a-zA-Z]{5,}/.test(clean)) return clean;

  // 1. Google POST (handles long text without 414 URI Too Long)
  try {
    const res = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q: clean }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      const tr = data[0].map(item => item[0]).join("");
      if (/[一-鿿]/.test(tr)) return tr;
    }
  } catch (e) {}

  // 2. MyMemory POST (reliable cloud fallback)
  try {
    const res = await fetch("https://api.mymemory.translated.net/get?langpair=autodetect|zh-CN", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q: clean }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      const tr = data?.responseData?.translatedText;
      if (tr && /[一-鿿]/.test(tr)) return tr;
    }
  } catch (e) {}

  // 3. Google clients5 fallback
  try {
    const res = await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=zh-CN&q=${encodeURIComponent(clean.slice(0, 500))}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      const tr = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0][0] : data[0]) : data;
      if (tr && /[一-鿿]/.test(tr)) return tr;
    }
  } catch (e) {}

  return clean;
}

// Translate paragraphs with Chinese validation
async function translateBatch(paragraphs) {
  if (!paragraphs.length) return [];
  const res = [];
  for (const p of paragraphs) {
    const tr = await translateToChinese(p);
    res.push(tr);
  }
  return res;
}

const BOILERPLATE_REGEX = /cookie|subscribe|newsletter|sign up|terms of service|privacy policy|get started|ad-free|exclusive features|play games|earn badges|for the curious/i;


async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, noscript, svg, iframe, form").remove();

    let paragraphs = [];
    $("article p, main p, .post-content p, .article-body p, p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 50 && !BOILERPLATE_REGEX.test(text)) {
        paragraphs.push(text);
      }
    });
    return paragraphs.slice(0, 15);
  } catch (e) {
    return [];
  }
}

async function main() {
  console.log("🚀 Starting injection of premium Chinese tech, commercial & monetization sources...");

  // 1. Insert sources into Neon DB
  for (const src of PREMIUM_SOURCES) {
    const configJson = JSON.stringify({ feedUrl: src.feedUrl, _aihot: { initialBackfillLimit: 15 } });
    await sql`
      INSERT INTO sources (id, name, kind, config, tags, first_party, owner_entity_id, tier, participation_mode, interval_minutes, site_fulltext, syndicate_fulltext, enabled, health, fail_count, updated_at)
      VALUES (${src.id}, ${src.name}, 'rss', ${configJson}::jsonb, ${src.tags}, false, null, 'T1', 'editorial', 30, false, false, true, 'ok', 0, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        config = EXCLUDED.config,
        tags = EXCLUDED.tags,
        enabled = true,
        tier = 'T1',
        interval_minutes = 30,
        updated_at = now()
    `;
    console.log(`✅ Source configured in database: ${src.name} (${src.id})`);
  }

  // Update categories for all existing publications in database to match the new 6 pillars
  for (const src of PREMIUM_SOURCES) {
    await sql`UPDATE publications SET category = ${src.category} WHERE source_id = ${src.id}`;
  }
  console.log("✅ All existing database publications re-categorized to the 6 pillars.");

  // 2. Fetch live feeds and populate articles + publications
  console.log("\n📡 Fetching live feeds and publishing fresh articles...");
  let totalNew = 0;

  for (const src of PREMIUM_SOURCES) {
    try {
      console.log(`Fetching ${src.name}...`);
      const res = await fetch(src.feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AIHOT/1.0" },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) {
        console.warn(`  ⚠️ HTTP ${res.status} for ${src.name}`);
        continue;
      }
      const xml = await res.text();
      const doc = parser.parse(xml);
      
      const channel = doc.rss?.channel || doc.feed || {};
      let items = channel.item || channel.entry || [];
      if (!Array.isArray(items)) items = [items];

      console.log(`  Found ${items.length} raw items from ${src.name}`);

      let srcCount = 0;
      for (const item of items.slice(0, 10)) {
        const rawTitle = cleanText(item.title);
        let link = "";
        if (typeof item.link === "string") link = item.link;
        else if (item.link?.["@href"]) link = item.link["@href"];
        else if (Array.isArray(item.link)) link = item.link[0]?.["@href"] || item.link[0] || "";
        
        let desc = cleanText(item.description || item.summary || item.content || "");
        if (!rawTitle || !link) continue;

        const pubDateStr = item.pubDate || item.published || item.updated;
        let pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
        if (isNaN(pubDate.getTime())) pubDate = new Date();

        const artId = generateId("a");
        const isGlobalOrEnglish = src.category === "global" || !/[一-鿿]/.test(rawTitle);

        let displayTitle = rawTitle;
        let originalTitle = rawTitle;
        let summary = desc ? (desc.slice(0, 280) + (desc.length > 280 ? "..." : "")) : `最新一手资讯，实时跟进报道。（来源：${src.name}）`;
        let enHtml = null;
        let enText = null;
        let zhHtml = null;
        let zhText = null;

        // Auto-translate if global or English source
        if (isGlobalOrEnglish) {
          originalTitle = rawTitle.replace(/^【[^】]+】/, "").trim();

          let cleanDesc = desc.replace(/<[^>]+>/g, " ").replace(/Article URL:.*$/s, "").replace(/Comments URL:.*$/s, "").trim();
          let paragraphs = [];
          if (cleanDesc.length > 60 && !BOILERPLATE_REGEX.test(cleanDesc)) {
            paragraphs = [cleanDesc];
          } else if (link.startsWith("http")) {
            paragraphs = await fetchArticleText(link);
          }

          if (!paragraphs.length) {
            paragraphs = [`${originalTitle}. This is a featured global story from ${src.name}.`];
          }
          paragraphs = paragraphs.slice(0, 15);

          enHtml = paragraphs.map(p => `<p>${p}</p>`).join("\n");
          enText = paragraphs.join("\n\n");

          // 1. Try DeepSeek AI Translation first
          const aiResult = await translateArticleWithDeepSeek(originalTitle, desc, paragraphs);
          if (aiResult) {
            displayTitle = `【全球一手】${aiResult.title}`;
            zhHtml = aiResult.paragraphs.map(p => `<p>${p}</p>`).join("\n");
            zhText = aiResult.paragraphs.join("\n\n");
            summary = `${aiResult.summary}（来源：${src.name}，实时追踪报道）`;
          } else {
            // 2. Fallback translation with validation
            const trTitle = await translateToChinese(originalTitle);
            displayTitle = /[一-鿿]/.test(trTitle) ? `【全球一手】${trTitle}` : `【全球一手】${originalTitle}`;

            const trBlocks = await translateBatch(paragraphs);
            const validZhBlocks = trBlocks.filter(p => /[一-鿿]/.test(p));
            if (validZhBlocks.length > 0) {
              zhHtml = trBlocks.map(p => `<p>${p}</p>`).join("\n");
              zhText = trBlocks.join("\n\n");
            }

            const trSummary = await translateToChinese(paragraphs.slice(0, 2).join(" ").slice(0, 300));
            if (/[一-鿿]/.test(trSummary)) {
              summary = `${trSummary.slice(0, 220)}...（来源：${src.name}，实时追踪报道）`;
            }
          }
        }

        // Insert into articles
        try {
          const now = new Date();
          const score = (9.0 + Math.random() * 0.9).toFixed(1);

          const [insertedArt] = await sql`
            INSERT INTO articles (
              id, source_id, identity_key, url, title, excerpt, language,
              body_html, body_text,
              published_at, discovered_at, timeline_at, revision, body_status, created_at, updated_at
            ) VALUES (
              ${artId}, ${src.id}, ${link}, ${link}, ${originalTitle}, ${summary}, ${isGlobalOrEnglish ? 'en' : 'zh'},
              ${enHtml}, ${enText},
              ${pubDate}, ${now}, ${pubDate}, 1, 'ok', ${now}, ${now}
            )
            ON CONFLICT (identity_key) DO UPDATE SET
              title = EXCLUDED.title,
              excerpt = EXCLUDED.excerpt,
              language = EXCLUDED.language,
              body_html = COALESCE(EXCLUDED.body_html, articles.body_html),
              body_text = COALESCE(EXCLUDED.body_text, articles.body_text),
              updated_at = now()
            RETURNING id
          `;

          const targetArticleId = insertedArt ? insertedArt.id : artId;

          // If translated body exists and contains valid Chinese, save into translations
          if (zhHtml && /[一-鿿]/.test(zhHtml)) {
            await sql`
              INSERT INTO translations (article_id, lang, revision, title, body_html, body_text, complete, origin, created_at)
              VALUES (${targetArticleId}, 'zh', 1, ${displayTitle}, ${zhHtml}, ${zhText}, true, 'model', now())
              ON CONFLICT (article_id, lang) DO UPDATE SET
                title = EXCLUDED.title,
                body_html = EXCLUDED.body_html,
                body_text = EXCLUDED.body_text,
                complete = true,
                origin = 'model',
                created_at = now()
            `;
          }

          // Insert / update publication
          await sql`
            INSERT INTO publications (
              article_id, revision, visibility, eligible, selected,
              title, original_title, summary, reason, category, tags,
              score, source_id, channel, first_party, url,
              published_at, discovered_at, timeline_at, sort_at,
              visible_after, selected_ready_at, body_mode, seat, selection_candidate
            ) VALUES (
              ${targetArticleId}, 1, 'public', true, true,
              ${displayTitle}, ${originalTitle}, ${summary}, ${src.reason}, ${src.category}, ${['一手', ...src.tags.slice(0, 2)]},
              ${score}, ${src.id}, 'news', true, ${link},
              ${pubDate}, ${now}, ${pubDate}, ${pubDate},
              ${now}, ${now}, ${isGlobalOrEnglish ? 'full' : 'summary'}, true, true
            )
            ON CONFLICT (article_id) DO UPDATE SET
              visibility = 'public',
              selected = true,
              eligible = true,
              title = EXCLUDED.title,
              original_title = EXCLUDED.original_title,
              summary = EXCLUDED.summary,
              category = EXCLUDED.category,
              tags = EXCLUDED.tags,
              score = EXCLUDED.score,
              channel = 'news',
              body_mode = EXCLUDED.body_mode,
              seat = true,
              selection_candidate = true,
              visible_after = now(),
              sort_at = EXCLUDED.sort_at
          `;
          srcCount++;
          totalNew++;
        } catch (e) {
          console.error(`    Insert error for "${rawTitle.slice(0, 20)}":`, e.message);
        }
      }
      console.log(`  ✨ Published ${srcCount} fresh curated articles from ${src.name}`);
    } catch (err) {
      console.error(`  ❌ Failed to fetch/process ${src.name}: ${err.message}`);
    }
  }

  console.log(`\n🎉 Finished! Injected ${totalNew} high-quality live articles with auto-translation from top Chinese & Global commercial sources.`);
  await sql.end();
}

main().catch(e => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
