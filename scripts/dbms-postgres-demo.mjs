import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL before running the PostgreSQL DBMS demonstration.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  const sql = await readFile(path.resolve("db/queries/POSTGRESQL_DBMS_DEMO.sql"), "utf8");
  const result = await client.query(sql);
  const results = Array.isArray(result) ? result : [result];
  const summaries = results
    .filter((statement) => statement.command !== "BEGIN" && statement.command !== "COMMIT" && statement.command !== "ROLLBACK")
    .map((statement) => ({ command: statement.command, rows: statement.rowCount }));
  console.log(JSON.stringify({ executedStatements: results.length, results: summaries }, null, 2));
} finally {
  client.release();
  await pool.end();
}
