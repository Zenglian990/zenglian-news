import postgres from "postgres";
import * as cheerio from "cheerio";

const connStr = "postgresql://neondb_owner:npg_ZhHSnk3d6QXW@ep-withered-silence-b7u1pctd-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";
const sql = postgres(connStr, { ssl: "require" });

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "sk-59d32686632a41eb8cff94f1b144921b";

async function translateWithDeepSeek(origTitle, origSummary, paragraphs) {
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
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content);
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
      if (text.length > 40 && !BOILERPLATE_REGEX.test(text)) {
        paragraphs.push(text);
      }
    });
    return paragraphs.slice(0, 10);
  } catch (e) {
    return [];
  }
}

async function run() {
  console.log("🚀 Scanning database for untranslated articles using DeepSeek AI Engine...");

  const rows = await sql`
    SELECT p.article_id, p.title, p.original_title, p.summary, p.source_id, s.name as source_name,
           a.url, a.language, a.body_html as orig_html, a.body_text as orig_text,
           tr.body_html as tr_body, tr.title as tr_title
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    JOIN articles a ON a.id = p.article_id
    LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh'
    WHERE p.category = 'global' OR s.id IN ('rss-hackernews', 'rss-openai', 'rss-producthunt')
    ORDER BY p.sort_at DESC
  `;

  console.log(`Found total ${rows.length} global candidate articles.`);

  let needTranslation = [];
  for (const row of rows) {
    const titleWithoutTag = (row.title || "").replace(/^【[^】]+】/, "").trim();
    const titleHasChinese = /[一-鿿]/.test(titleWithoutTag);
    const bodySample = (row.tr_body || "").slice(0, 300).replace(/<[^>]+>/g, "").trim();
    const bodyHasChinese = /[一-鿿]/.test(bodySample);

    // If title has no Chinese or body has no Chinese, it MUST be translated
    if (!titleHasChinese || !bodyHasChinese) {
      needTranslation.push(row);
    }
  }

  console.log(`📋 Need translation: ${needTranslation.length} articles.`);

  for (let i = 0; i < needTranslation.length; i++) {
    const row = needTranslation[i];
    const origTitle = row.original_title || (row.title || "").replace(/^【[^】]+】/, "").trim();
    console.log(`\n[${i + 1}/${needTranslation.length}] Translating "${origTitle}" (${row.source_name})...`);

    // 1. Gather original paragraphs
    let paragraphs = [];
    if (row.orig_html && row.orig_html.length > 50) {
      const $ = cheerio.load(row.orig_html);
      $("p").each((_, el) => {
        const t = $(el).text().trim();
        if (t && !BOILERPLATE_REGEX.test(t)) paragraphs.push(t);
      });
    }

    if (paragraphs.length === 0 && row.url && row.url.startsWith("http")) {
      paragraphs = await fetchArticleText(row.url);
    }

    if (paragraphs.length === 0) {
      const fallbackDesc = (row.summary || "").replace(/<[^>]+>/g, " ").replace(/Article URL:.*$/s, "").replace(/Comments URL:.*$/s, "").trim();
      if (fallbackDesc.length > 20) paragraphs.push(fallbackDesc);
      else paragraphs.push(`${origTitle}. Reported by ${row.source_name}.`);
    }

    paragraphs = paragraphs.slice(0, 10);
    const enHtml = paragraphs.map(p => `<p>${p}</p>`).join("\n");
    const enText = paragraphs.join("\n\n");

    try {
      // 2. Call DeepSeek
      const trResult = await translateWithDeepSeek(origTitle, row.summary || "", paragraphs);
      
      const zhTitle = `【全球一手】${trResult.title}`;
      const zhHtml = trResult.paragraphs.map(p => `<p>${p}</p>`).join("\n");
      const zhText = trResult.paragraphs.join("\n\n");
      const zhSummary = `${trResult.summary}（来源：${row.source_name}，实时追踪报道）`;

      // 3. Update Database
      await sql`
        UPDATE articles
        SET language = 'en',
            body_html = ${enHtml},
            body_text = ${enText},
            updated_at = now()
        WHERE id = ${row.article_id}
      `;

      await sql`
        INSERT INTO translations (article_id, lang, revision, title, body_html, body_text, complete, origin, created_at)
        VALUES (${row.article_id}, 'zh', 1, ${zhTitle}, ${zhHtml}, ${zhText}, true, 'model', now())
        ON CONFLICT (article_id, lang) DO UPDATE SET
          title = EXCLUDED.title,
          body_html = EXCLUDED.body_html,
          body_text = EXCLUDED.body_text,
          complete = true,
          origin = 'model',
          created_at = now()
      `;

      await sql`
        UPDATE publications
        SET title = ${zhTitle},
            original_title = ${origTitle},
            summary = ${zhSummary},
            body_mode = 'full'
        WHERE article_id = ${row.article_id}
      `;

      console.log(`  ✅ Done: "${zhTitle}"`);
      console.log(`     Summary: ${zhSummary.slice(0, 60)}...`);
    } catch (err) {
      console.error(`  ❌ Failed to translate article ${row.article_id}:`, err.message);
    }

    // Gentle sleep to avoid rate limits
    await new Promise(r => setTimeout(r, 400));
  }

  console.log("\n🎉 All untranslated articles have been processed with DeepSeek!");
  await sql.end();
}

run().catch(console.error);
