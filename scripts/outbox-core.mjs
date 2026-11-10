const ACTIVE_LEASE = "2 minutes";

export async function publishBatch({ pool, collection, batchSize = 25, maxAttempts = 8, random = Math.random, eventIds }) {
  const client = await pool.connect();
  let events;
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      "SELECT event_id,aggregate_type,aggregate_id,event_type,payload,attempt_count FROM event_outbox WHERE outbox_status='PENDING' AND available_at<=now() AND (locked_at IS NULL OR locked_at<now()-$2::interval) AND ($3::uuid[] IS NULL OR event_id=ANY($3::uuid[])) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1",
      [batchSize, ACTIVE_LEASE, eventIds ?? null],
    );
    events = claimed.rows;
    if (events.length) await client.query("UPDATE event_outbox SET locked_at=now(),last_attempt_at=now() WHERE event_id=ANY($1::uuid[])", [events.map((event) => event.event_id)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }

  let published = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const payload = event.payload ?? {};
      await collection.updateOne({ eventId: event.event_id }, { $setOnInsert: {
        eventId: event.event_id,
        incidentId: event.aggregate_id,
        aggregateType: event.aggregate_type,
        eventType: event.event_type,
        occurredAt: new Date(),
        actorUserId: payload.actorUserId ?? null,
        source: payload.source ?? "sera",
        summary: payload.summary ?? event.event_type,
        details: payload.details ?? {},
      } }, { upsert: true });
      await pool.query("UPDATE event_outbox SET outbox_status='PUBLISHED',published_at=now(),locked_at=NULL,last_error=NULL WHERE event_id=$1 AND outbox_status='PENDING'", [event.event_id]);
      published++;
    } catch (error) {
      failed++;
      const attempt = event.attempt_count + 1;
      const base = Math.min(3600, 2 ** attempt);
      const jittered = Math.max(1, Math.round(base * (0.8 + random() * 0.4)));
      const message = String(error).replace(/[\r\n\t]/g, " ").slice(0, 1000);
      await pool.query("UPDATE event_outbox SET attempt_count=$2::integer,last_attempt_at=now(),last_error=$3::text,locked_at=NULL,available_at=now()+($4::text||' seconds')::interval,outbox_status=CASE WHEN $2::integer >= $5::integer THEN 'FAILED' ELSE 'PENDING' END WHERE event_id=$1", [event.event_id,attempt,message,jittered,maxAttempts]);
    }
  }
  return { claimed: events.length, published, failed };
}
