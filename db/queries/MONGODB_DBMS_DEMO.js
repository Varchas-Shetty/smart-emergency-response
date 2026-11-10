async function main() {
  if (!process.env.MONGODB_URI || !process.env.DATABASE_URL) {
    throw new Error("Set MONGODB_URI and DATABASE_URL before running the MongoDB DBMS demonstration.");
  }

  const [{ MongoClient }, { default: pg }] = await Promise.all([
    import("mongodb"),
    import("pg"),
  ]);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    const incident = await pool.query(
      "SELECT incident_id FROM emergency_incidents ORDER BY created_at DESC LIMIT $1",
      [1],
    );
    if (!incident.rowCount) {
      throw new Error("The MongoDB DBMS demo requires at least one PostgreSQL incident.");
    }

    await mongo.connect();
    const { runMongoDbmsOperations } = await import("../../scripts/mongodb-demo-core.mjs");
    const collection = mongo.db(process.env.MONGODB_DB_NAME ?? "emergency_ops").collection("incident_events");
    const result = await runMongoDbmsOperations(collection, incident.rows[0].incident_id);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongo.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("MongoDB DBMS demonstration failed", error);
  process.exitCode = 1;
});
