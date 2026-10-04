import postgres from "postgres";

const connStr = "postgresql://neondb_owner:npg_ZhHSnk3d6QXW@ep-withered-silence-b7u1pctd-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require";
const sql = postgres(connStr, { ssl: "require" });

async function main() {
  const indexes = await sql`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'articles';
  `;
  console.log("Indexes on articles:", JSON.stringify(indexes, null, 2));
  await sql.end();
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
