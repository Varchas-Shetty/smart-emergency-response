import pg from "pg";
import { MongoClient } from "mongodb";
import { publishBatch } from "./outbox-core.mjs";

const intervalMs = Math.max(1000, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 3000));
const batchSize = Math.max(1, Math.min(100, Number(process.env.OUTBOX_BATCH_SIZE ?? 25)));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 4 });
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const db = mongo.db(process.env.MONGODB_DB_NAME ?? "emergency_ops");
  const events = db.collection("incident_events");
  let indexesReady = false;
  console.log(`Outbox worker started; polling every ${intervalMs}ms, batch size ${batchSize}.`);
  while (!stopping) {
    try {
      await mongo.connect();
      if (!indexesReady) {
        await events.createIndex({ eventId: 1 }, { unique: true });
        await events.createIndex({ incidentId: 1, occurredAt: -1 });
        indexesReady = true;
      }
      const result = await publishBatch({ pool, collection: events, batchSize });
      if (result.claimed) console.log(`Outbox batch: published=${result.published}, retry_or_failed=${result.failed}.`);
    } catch (error) {
      console.error(`Outbox batch failed: ${String(error).replace(/[\r\n\t]/g, " ").slice(0, 400)}`);
    }
    if (!stopping) await delay(intervalMs);
  }
} finally {
  await mongo.close();
  await pool.end();
  console.log("Outbox worker stopped.");
}
