import postgres from "postgres";

const connStr = (process.env.DATABASE_URL || "").trim();
if (!connStr) {
  console.error("Missing required DATABASE_URL environment variable");
  process.exit(1);
}
const sql = postgres(connStr, {
  ssl: /127\.0\.0\.1|localhost/.test(connStr) || connStr.includes("sslmode=disable") ? false : "require",
  max: 3,
  connect_timeout: 20,
  idle_timeout: 240,
});

async function checkNonChinese() {
  const rows = await sql`
    SELECT p.article_id, p.title, p.original_title, p.category, s.name as source_name,
           tr.body_html as tr_body, a.body_html as a_body, tr.created_at as tr_at
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    JOIN articles a ON a.id = p.article_id
    LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh'
    WHERE p.category = 'global'
    ORDER BY p.sort_at DESC
  `;

  console.log(`Total global articles: ${rows.length}`);
  let nonZhCount = 0;
  for (const r of rows) {
    const titleHasChinese = /[一-鿿]/.test(r.title);
    const bodySample = (r.tr_body || "").slice(0, 200).replace(/<[^>]+>/g, "").trim();
    const bodyHasChinese = /[一-鿿]/.test(bodySample);

    if (!titleHasChinese || !bodyHasChinese) {
      nonZhCount++;
      console.log(`❌ Untranslated [${r.article_id}] (${r.source_name}):`);
      console.log(`   Title: ${r.title}`);
      console.log(`   Body sample: ${bodySample.slice(0, 80)}`);
      console.log(`   tr_at: ${r.tr_at}`);
    }
  }
  console.log(`\nFound ${nonZhCount} untranslated articles.`);
}

checkNonChinese()
  .catch((err) => {
    console.error("FATAL ERROR:", err);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }).catch(() => {}));
