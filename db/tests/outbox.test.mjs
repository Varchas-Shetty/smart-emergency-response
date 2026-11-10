import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { MongoClient } from "mongodb";
import { publishBatch } from "../../scripts/outbox-core.mjs";

const enabled = Boolean(process.env.DATABASE_URL && process.env.MONGODB_URI);

test("outbox publisher claims once, upserts idempotently, retries, and dead-letters", { skip: !enabled && "DATABASE_URL and MONGODB_URI are required" }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
  const eventId = randomUUID();
  const failedEventId = randomUUID();
  const collection = () => mongo.db(process.env.MONGODB_DB_NAME ?? "emergency_ops").collection("incident_events");
  try {
    await mongo.connect();
    await pool.query("INSERT INTO event_outbox(event_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'incident',1,'TEST_OUTBOX',$2::jsonb)", [eventId,JSON.stringify({source:"integration-test",summary:"Synthetic outbox test"})]);

    const concurrent = await Promise.all([
      publishBatch({ pool, collection: collection(), batchSize: 1, eventIds: [eventId] }),
      publishBatch({ pool, collection: collection(), batchSize: 1, eventIds: [eventId] }),
    ]);
    assert.equal(concurrent.reduce((sum,result)=>sum+result.published,0),1,"competing workers publish a claimed event once");
    assert.equal(await collection().countDocuments({eventId}),1,"Mongo idempotency key has one document");
    const publishedRow = (await pool.query("SELECT outbox_status,last_attempt_at FROM event_outbox WHERE event_id=$1",[eventId])).rows[0];
    assert.equal(publishedRow.outbox_status,"PUBLISHED");
    assert.ok(publishedRow.last_attempt_at);

    await pool.query("INSERT INTO event_outbox(event_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'incident',1,'TEST_OUTBOX_FAILURE',$2::jsonb)", [failedEventId,JSON.stringify({source:"integration-test",summary:"Synthetic outbox failure"})]);
    const brokenCollection = { updateOne: async () => { throw new Error("synthetic Mongo outage"); } };
    const firstFailure = await publishBatch({ pool, collection: brokenCollection, batchSize: 1, maxAttempts: 2, random: () => 0.5, eventIds: [failedEventId] });
    assert.equal(firstFailure.failed,1);
    let failedRow = (await pool.query("SELECT outbox_status,attempt_count,last_attempt_at,last_error FROM event_outbox WHERE event_id=$1",[failedEventId])).rows[0];
    assert.equal(failedRow.outbox_status,"PENDING"); assert.equal(failedRow.attempt_count,1); assert.match(failedRow.last_error,/synthetic Mongo outage/);
    assert.ok(failedRow.last_attempt_at);
    await pool.query("UPDATE event_outbox SET available_at=now() WHERE event_id=$1",[failedEventId]);
    const terminalFailure = await publishBatch({ pool, collection: brokenCollection, batchSize: 1, maxAttempts: 2, random: () => 0.5, eventIds: [failedEventId] });
    assert.equal(terminalFailure.failed,1);
    failedRow = (await pool.query("SELECT outbox_status,attempt_count FROM event_outbox WHERE event_id=$1",[failedEventId])).rows[0];
    assert.equal(failedRow.outbox_status,"FAILED"); assert.equal(failedRow.attempt_count,2);
  } finally {
    await collection().deleteMany({eventId:{$in:[eventId,failedEventId]}}).catch(()=>{});
    await pool.query("DELETE FROM event_outbox WHERE event_id=ANY($1::uuid[])",[[eventId,failedEventId]]).catch(()=>{});
    await mongo.close(); await pool.end();
  }
});
