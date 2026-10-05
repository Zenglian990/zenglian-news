import postgres from "postgres";
import * as cheerio from "cheerio";

const connStr = "postgresql://neondb_owner:npg_ZhHSnk3d6QXW@ep-withered-silence-b7u1pctd-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";
const sql = postgres(connStr, { ssl: "require" });

// Fast translation helper
async function translateText(text) {
  if (!text || !text.trim()) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(clean)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return text;
    const data = await res.json();
    return data[0].map(item => item[0]).join("");
  } catch (e) {
    return text;
  }
}

// Translate multiple paragraphs in one batch
async function translateBatch(paragraphs) {
  if (!paragraphs.length) return [];
  const joined = paragraphs.join("\n\n---P---\n\n");
  const translatedJoined = await translateText(joined);
  const parts = translatedJoined.split(/---P---|---\s*P\s*---/);
  if (parts.length === paragraphs.length) {
    return parts.map(p => p.trim());
  }
  // Fallback to sequential if delimiter is lost
  const res = [];
  for (const p of paragraphs) {
    res.push(await translateText(p));
  }
  return res;
}

const BOILERPLATE_REGEX = /cookie|subscribe|newsletter|sign up|terms of service|privacy policy|get started|ad-free|exclusive features|play games|earn badges|for the curious/i;

// Fetch article text from web
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
  console.log("🚀 Starting fast translation of all Global (全球榜) articles...");

  // Query global publications
  const rows = await sql`
    SELECT p.article_id, p.title, p.original_title, p.summary, p.source_id, s.name as source_name,
           a.url, a.language, a.body_html, a.body_text, a.revision,
           tr.complete as tr_complete, tr.body_html as tr_body
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    JOIN articles a ON a.id = p.article_id
    LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh'
    WHERE p.category = 'global'
    ORDER BY p.sort_at DESC
  `;

  console.log(`Found ${rows.length} global articles to verify/process.`);

  let processed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const articleId = row.article_id;
    const origTitle = row.original_title || row.title.replace(/^【[^】]+】/, "").trim();

    // Check if already completely translated and has substantial body
    const hasChineseTitle = /[一-鿿]/.test(row.title) && !row.title.startsWith("【一手快讯】");
    const hasValidTranslation = row.tr_complete && row.tr_body && row.tr_body.length > 50;
    
    // Check if body had boilerplate like Live Science
    const hasBoilerplate = row.tr_body && (row.tr_body.includes("徽章") || row.tr_body.includes("玩游戏"));

    if (hasChineseTitle && hasValidTranslation && !hasBoilerplate) {
      // Already good
      continue;
    }

    console.log(`\n-----------------------------------------`);
    console.log(`[${i + 1}/${rows.length}] Processing: "${origTitle}" (${row.source_name})`);

    // 1. Determine English Body Paragraphs
    let enParagraphs = [];
    if (row.body_html && row.body_html.length > 100 && !hasBoilerplate) {
      const $ = cheerio.load(row.body_html);
      $("p").each((_, el) => {
        const t = $(el).text().trim();
        if (t && !BOILERPLATE_REGEX.test(t)) enParagraphs.push(t);
      });
      enParagraphs = enParagraphs.slice(0, 15);
    }

    if (enParagraphs.length === 0 && row.url && row.url.startsWith("http")) {
      console.log(`  🌐 Fetching clean web page content: ${row.url.slice(0, 60)}...`);
      enParagraphs = await fetchArticleText(row.url);
    }

    // Fallback if web fetch returned nothing: use summary or title
    if (enParagraphs.length === 0) {
      let cleanSummary = (row.summary || "").replace(/<[^>]+>/g, " ").replace(/Article URL:.*$/s, "").replace(/Comments URL:.*$/s, "").trim();
      if (cleanSummary && cleanSummary.length > 30 && !BOILERPLATE_REGEX.test(cleanSummary)) {
        enParagraphs = [cleanSummary];
      } else {
        enParagraphs = [
          `${origTitle}. This is a featured global story from ${row.source_name}. Visit the original source for full coverage and real-time community discussions.`
        ];
      }
    }

    // Limit to max 15 paragraphs
    enParagraphs = enParagraphs.slice(0, 15);

    const enHtml = enParagraphs.map(p => `<p>${p}</p>`).join("\n");
    const enText = enParagraphs.join("\n\n");

    // 2. Translate Title to Chinese
    let zhTitle = row.title;
    if (!hasChineseTitle) {
      const rawTrTitle = await translateText(origTitle);
      zhTitle = `【全球一手】${rawTrTitle}`;
    }

    // 3. Translate Summary to Chinese
    let cleanSummary = (row.summary || "").replace(/<[^>]+>/g, " ").replace(/Article URL:.*$/s, "").replace(/Comments URL:.*$/s, "").replace(/（来源：.*）/, "").trim();
    if (!cleanSummary || cleanSummary.length < 15 || BOILERPLATE_REGEX.test(cleanSummary)) {
      cleanSummary = enParagraphs.slice(0, 2).join(" ");
    }
    const zhSummaryRaw = await translateText(cleanSummary.slice(0, 300));
    const zhSummary = `${zhSummaryRaw.slice(0, 220)}...（来源：${row.source_name}，实时追踪报道）`;

    // 4. Fast batch translate body to Chinese
    console.log(`  🌐 Translating ${enParagraphs.length} body paragraphs...`);
    const translatedBlocks = await translateBatch(enParagraphs);
    const zhHtml = translatedBlocks.map(p => `<p>${p}</p>`).join("\n");
    const zhText = translatedBlocks.join("\n\n");

    // 5. Save to Neon PostgreSQL
    // Update articles
    await sql`
      UPDATE articles
      SET language = 'en',
          body_html = ${enHtml},
          body_text = ${enText},
          updated_at = now()
      WHERE id = ${articleId}
    `;

    // Upsert into translations
    await sql`
      INSERT INTO translations (article_id, lang, revision, title, body_html, body_text, complete, origin, created_at)
      VALUES (${articleId}, 'zh', ${row.revision || 1}, ${zhTitle}, ${zhHtml}, ${zhText}, true, 'model', now())
      ON CONFLICT (article_id, lang) DO UPDATE SET
        title = EXCLUDED.title,
        body_html = EXCLUDED.body_html,
        body_text = EXCLUDED.body_text,
        complete = true,
        origin = 'model',
        created_at = now()
    `;

    // Update publications
    await sql`
      UPDATE publications
      SET title = ${zhTitle},
          original_title = ${origTitle},
          summary = ${zhSummary},
          body_mode = 'full'
      WHERE article_id = ${articleId}
    `;

    console.log(`  ✅ Successfully updated article ${articleId}`);
    console.log(`     中文标题: ${zhTitle}`);
    console.log(`     段落数: ${translatedBlocks.length}`);
    processed++;
  }

  console.log(`\n🎉 Completed fast translation of ${processed} global articles in Neon DB!`);
  await sql.end();
}

main().catch(e => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
