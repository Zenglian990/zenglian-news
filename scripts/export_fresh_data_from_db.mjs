import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const DATABASE_URL = "postgresql://neondb_owner:npg_ZhHSnk3d6QXW@ep-withered-silence-b7u1pctd-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function exportData() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const categories = ["global", "domestic", "business", "tech", "money", "culture"];
  const outDir = path.resolve("data");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const cat of categories) {
    const res = await client.query(`
      SELECT p.article_id, p.title, p.original_title, p.summary, p.url,
             p.published_at, p.discovered_at, p.category, p.score, p.selected, p.reason,
             s.name as source_name
      FROM publications p
      LEFT JOIN sources s ON s.id = p.source_id
      WHERE p.visibility = 'public' AND p.category = $1
      ORDER BY p.published_at DESC
      LIMIT 40
    `, [cat]);

    const items = res.rows.map(row => ({
      id: row.article_id,
      title: row.title,
      originalTitle: row.original_title || row.title,
      summary: row.summary || "",
      source: { name: row.source_name || "权威信源" },
      links: {
        aihot: `https://zenglian-news.onrender.com/items/${row.article_id}`,
        original: row.url || ""
      },
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : new Date().toISOString(),
      discoveredAt: row.discovered_at ? new Date(row.discovered_at).toISOString() : new Date().toISOString(),
      category: row.category,
      score: row.score ? Math.round(Number(row.score)) : 10,
      selected: row.selected !== false,
      reason: row.reason || "权威实时追踪报道",
      attribution: {
        name: "曾练全球一手新闻",
        url: `https://zenglian-news.onrender.com/items/${row.article_id}`
      }
    }));

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
      items,
      page: {
        count: items.length,
        hasMore: true,
        nextCursor: null
      }
    };

    const targetFile = path.join(outDir, `${cat}.json`);
    const jsonStr = JSON.stringify(payload, null, 2);
    // Write strictly as UTF-8 without BOM!
    fs.writeFileSync(targetFile, jsonStr, "utf8");
    console.log(`[OK] Exported ${cat}.json: ${items.length} items (${Buffer.byteLength(jsonStr)} bytes), latest: ${items[0]?.title} (${items[0]?.publishedAt})`);
  }

  await client.end();
}

exportData().catch(err => {
  console.error("Export failed:", err);
  process.exit(1);
});
