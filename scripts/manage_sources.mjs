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

async function main() {
  const rows = await sql`
    SELECT p.title, s.name as source, p.published_at, p.timeline_at, p.sort_at 
    FROM publications p 
    JOIN sources s ON s.id = p.source_id 
    ORDER BY p.sort_at DESC 
    LIMIT 6;
  `;
  console.log("Latest Publications:", JSON.stringify(rows, null, 2));
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }).catch(() => {}));
