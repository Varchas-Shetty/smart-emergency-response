import { randomUUID } from "node:crypto";
import pg from "pg";
import { MongoClient } from "mongodb";

function parseUrl(name, raw) {
  if (!raw) throw new Error(`${name} is missing.`);
  if (raw !== raw.trim() || raw.startsWith(`${name}=`)) throw new Error(`${name} has whitespace or a duplicated variable prefix.`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${name} is not a valid URL.`); }
  return url;
}

const databaseUrl = parseUrl("DATABASE_URL", process.env.DATABASE_URL);
if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") throw new Error("DATABASE_URL must use PostgreSQL.");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "5432" || databaseUrl.pathname !== "/smart_emergency_response" || decodeURIComponent(databaseUrl.username) !== "sera_app") throw new Error("DATABASE_URL does not target the configured local application database.");
console.log(`DATABASE_URL present=true syntax=valid host=${databaseUrl.hostname} port=${databaseUrl.port} database=${databaseUrl.pathname.slice(1)} username=${decodeURIComponent(databaseUrl.username)} password_present=${Boolean(databaseUrl.password)}`);

const pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 1, connectionTimeoutMillis: 5000 });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT current_database() AS database,current_user AS username");
    if (result.rows[0].database !== "smart_emergency_response" || result.rows[0].username !== "sera_app") throw new Error("PostgreSQL authenticated as an unexpected identity.");
    await client.query("SELECT 1");
    await client.query("ROLLBACK");
    console.log("PostgreSQL connectivity=pass authentication=pass read=pass transaction=pass");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }

const mongoUrl = parseUrl("MONGODB_URI", process.env.MONGODB_URI);
if (mongoUrl.protocol !== "mongodb:" || mongoUrl.hostname !== "127.0.0.1" || mongoUrl.port !== "27017" || process.env.MONGODB_DB_NAME !== "emergency_ops") throw new Error("MongoDB configuration does not target the configured local development database.");
console.log(`MONGODB_URI present=true syntax=valid host=${mongoUrl.hostname} port=${mongoUrl.port} database=${process.env.MONGODB_DB_NAME}`);
const mongo = new MongoClient(mongoUrl.toString(), { serverSelectionTimeoutMS: 5000 });
try {
  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB_NAME);
  await db.command({ ping: 1 });
  const events = db.collection("incident_events");
  await events.createIndex({ eventId: 1 }, { unique: true });
  await events.createIndex({ incidentId: 1, occurredAt: -1 });
  const eventId = `preflight-${randomUUID()}`;
  await events.insertOne({ eventId, incidentId: -1, eventType: "PREFLIGHT", occurredAt: new Date() });
  const found = await events.findOne({ eventId }, { projection: { _id: 1 } });
  await events.deleteOne({ eventId });
  if (!found) throw new Error("MongoDB event round-trip failed.");
  console.log("MongoDB connectivity=pass ping=pass collection=incident_events insert_retrieve=pass indexes=pass");
} finally { await mongo.close(); }
