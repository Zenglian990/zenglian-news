import postgres from "postgres";
import { XMLParser } from "fast-xml-parser";
import crypto from "node:crypto";
import fs from "node:fs";

const connStr = "postgresql://neondb_owner:npg_ZhHSnk3d6QXW@ep-withered-silence-b7u1pctd-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";
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
    tags: ["国内", "AI", "前沿"],
    category: "ai-models",
    reason: "国内最顶尖AI产业前沿，大模型落地与商业化一手洞察。"
  },
  {
    id: "rss-geekpark",
    name: "极客公园",
    feedUrl: "https://www.geekpark.net/rss",
    tags: ["商业", "创投", "创新"],
    category: "industry",
    reason: "科技商业创投与AI产品创新，聚焦创始人与商业落地。"
  },
  {
    id: "rss-huxiu",
    name: "虎嗅网",
    feedUrl: "https://rss.huxiu.com/",
    tags: ["商业", "深度", "科技"],
    category: "industry",
    reason: "权威商业洞察与产业内幕，洞悉科技趋势与市场风向。"
  },
  {
    id: "rss-ifanr",
    name: "爱范儿",
    feedUrl: "https://www.ifanr.com/feed",
    tags: ["产品", "硬件", "消费科技"],
    category: "ai-products",
    reason: "爆款数码科技、AI硬件与创新消费产品一手前沿。"
  },
  {
    id: "rss-tmtpost",
    name: "钛媒体",
    feedUrl: "https://www.tmtpost.com/rss.xml",
    tags: ["创投", "资本", "科技"],
    category: "industry",
    reason: "全球科技财经与资本创投动态，商业决策核心参考。"
  },
  {
    id: "rss-jiemian",
    name: "界面新闻·科技",
    feedUrl: "https://a.jiemian.com/index.php?m=article&a=rss",
    tags: ["财经", "商业", "巨头"],
    category: "industry",
    reason: "主流商业财经媒体，实时追踪国内外科技巨头战略动向。"
  },
  {
    id: "rss-producthunt",
    name: "Product Hunt·AI落地",
    feedUrl: "https://www.producthunt.com/feed",
    tags: ["搞钱", "神器", "产品"],
    category: "ai-products",
    reason: "全球最新AI变现神器与落地工具，独立开发与出海赚钱首选。"
  },
  {
    id: "rss-sspai",
    name: "少数派",
    feedUrl: "https://sspai.com/feed",
    tags: ["教程", "效率", "工具"],
    category: "tip",
    reason: "实用效率生产力与AI工具实战技巧，落地提效指南。"
  },
  {
    id: "rss-ithome",
    name: "IT之家·一手快讯",
    feedUrl: "https://www.ithome.com/rss/",
    tags: ["一手", "快讯", "大厂"],
    category: "ai-products",
    reason: "科技互联网与大厂软硬件实时极速快讯，一手资讯不遗漏。"
  },
  {
    id: "rss-oschina",
    name: "开源中国",
    feedUrl: "https://www.oschina.net/news/rss",
    tags: ["开源", "工具", "生态"],
    category: "paper",
    reason: "开源软件动态与技术前沿，掌握全球开源技术生态脉搏。"
  },
  {
    id: "rss-v2ex",
    name: "V2EX·搞钱创造",
    feedUrl: "https://www.v2ex.com/index.xml",
    tags: ["副业", "创造", "灵感"],
    category: "tip",
    reason: "独立开发者创业、副业变现与技术人灵感聚集地。"
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

  // 2. Fetch live items from each source and populate articles + publications
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
        const summary = desc ? (desc.slice(0, 280) + (desc.length > 280 ? "..." : "")) : `最新一手资讯，实时跟进报道。（来源：${src.name}）`;
        const contentJson = JSON.stringify([{ kind: "text", text: desc || rawTitle }]);

        // Insert into articles
        try {
          const now = new Date();
          const score = (9.0 + Math.random() * 0.9).toFixed(1);

          const [insertedArt] = await sql`
            INSERT INTO articles (
              id, source_id, identity_key, url, title, excerpt, 
              published_at, discovered_at, timeline_at, revision, body_status, created_at, updated_at
            ) VALUES (
              ${artId}, ${src.id}, ${link}, ${link}, ${rawTitle}, ${summary}, 
              ${pubDate}, ${now}, ${pubDate}, 1, 'ok', ${now}, ${now}
            )
            ON CONFLICT (identity_key) DO UPDATE SET
              title = EXCLUDED.title,
              excerpt = EXCLUDED.excerpt,
              updated_at = now()
            RETURNING id
          `;

          const targetArticleId = insertedArt ? insertedArt.id : artId;

          await sql`
            INSERT INTO publications (
              article_id, revision, visibility, eligible, selected,
              title, original_title, summary, reason, category, tags,
              score, source_id, channel, first_party, url,
              published_at, discovered_at, timeline_at, sort_at,
              visible_after, selected_ready_at, body_mode, seat, selection_candidate
            ) VALUES (
              ${targetArticleId}, 1, 'public', true, true,
              ${rawTitle}, ${rawTitle}, ${summary}, ${src.reason}, ${src.category}, ${['一手', ...src.tags.slice(0, 2)]},
              ${score}, ${src.id}, 'news', true, ${link},
              ${pubDate}, ${now}, ${pubDate}, ${pubDate},
              ${now}, ${now}, 'summary', true, true
            )
            ON CONFLICT (article_id) DO UPDATE SET
              visibility = 'public',
              selected = true,
              eligible = true,
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              category = EXCLUDED.category,
              tags = EXCLUDED.tags,
              score = EXCLUDED.score,
              channel = 'news',
              body_mode = 'summary',
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

  console.log(`\n🎉 Finished! Injected ${totalNew} high-quality live articles from top Chinese & Global commercial sources.`);
  await sql.end();
}

main().catch(e => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
