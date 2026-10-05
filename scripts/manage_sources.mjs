import postgres from "postgres";

const connStr = "postgresql://neondb_owner:npg_ZhHSnk3d6QXW@ep-withered-silence-b7u1pctd-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";
const sql = postgres(connStr, { ssl: "require" });

async function main() {
  const rows = await sql`
    SELECT p.title, s.name as source, p.published_at, p.timeline_at, p.sort_at 
    FROM publications p 
    JOIN sources s ON s.id = p.source_id 
    ORDER BY p.sort_at DESC 
    LIMIT 6;
  `;
  console.log("Latest Publications:", JSON.stringify(rows, null, 2));
  await sql.end();
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
