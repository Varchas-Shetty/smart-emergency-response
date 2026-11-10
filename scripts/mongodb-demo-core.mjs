import { randomUUID } from "node:crypto";

const DEMO_EVENT_INDEX = "incident_events_type_time_idx";

export async function runMongoDbmsOperations(collection, incidentId) {
  const runId = randomUUID();
  const demoEvents = [
    {
      eventId: `dbms-demo:${runId}:insert-one`,
      incidentId,
      eventType: "DBMS_DEMO_INCIDENT",
      occurredAt: new Date(),
      source: "dbms-demo",
      demoRunId: runId,
      summary: "Disposable incident activity record",
      details: { operation: "insertOne" },
    },
    {
      eventId: `dbms-demo:${runId}:dispatch`,
      incidentId,
      eventType: "DBMS_DEMO_DISPATCH",
      occurredAt: new Date(Date.now() + 1000),
      source: "dbms-demo",
      demoRunId: runId,
      summary: "Disposable dispatch activity record",
      details: { operation: "insertMany" },
    },
    {
      eventId: `dbms-demo:${runId}:resource`,
      incidentId,
      eventType: "DBMS_DEMO_RESOURCE_ALLOCATION",
      occurredAt: new Date(Date.now() + 2000),
      source: "dbms-demo",
      demoRunId: runId,
      summary: "Disposable resource allocation activity record",
      details: { operation: "insertMany" },
    },
  ];

  try {
    await collection.createIndex(
      { eventType: 1, occurredAt: -1 },
      { name: DEMO_EVENT_INDEX },
    );
    await collection.insertOne(demoEvents[0]);
    const insertedMany = await collection.insertMany(demoEvents.slice(1));

    const runFilter = { source: "dbms-demo", demoRunId: runId };
    const eventCount = await collection.countDocuments(runFilter);
    const recentEvents = await collection
      .find(runFilter, { projection: { _id: 0, eventId: 1, incidentId: 1, eventType: 1, occurredAt: 1, summary: 1 } })
      .sort({ occurredAt: -1 })
      .limit(5)
      .toArray();
    const firstEvent = await collection.findOne({ eventId: demoEvents[0].eventId, demoRunId: runId });
    const oneUpdated = await collection.updateOne(
      { eventId: demoEvents[0].eventId, demoRunId: runId },
      { $set: { "details.reviewed": true } },
    );
    const manyUpdated = await collection.updateMany(
      runFilter,
      { $set: { demoUpdatedAt: new Date() } },
    );

    const eventCountsByType = await collection
      .aggregate([
        { $match: { incidentId } },
        { $group: { _id: "$eventType", eventCount: { $sum: 1 } } },
        { $sort: { eventCount: -1, _id: 1 } },
        { $limit: 10 },
      ])
      .toArray();
    const activityByDay = await collection
      .aggregate([
        { $match: { incidentId, occurredAt: { $type: "date" } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt" } },
            eventCount: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ])
      .toArray();
    const incidentHistory = await collection
      .find({ incidentId }, { projection: { _id: 0, eventId: 1, eventType: 1, occurredAt: 1, summary: 1, source: 1 } })
      .sort({ occurredAt: 1 })
      .limit(20)
      .toArray();
    const indexes = await collection.listIndexes().toArray();
    const deleted = await collection.deleteOne({
      eventId: demoEvents[0].eventId,
      source: "dbms-demo",
      demoRunId: runId,
    });

    return {
      incidentId,
      insertedOne: 1,
      insertedMany: insertedMany.insertedCount,
      countDocuments: eventCount,
      sortedLimitedEvents: recentEvents,
      findOneMatched: firstEvent !== null,
      updateOneModified: oneUpdated.modifiedCount,
      updateManyModified: manyUpdated.modifiedCount,
      deleteOneDeleted: deleted.deletedCount,
      eventCountsByType,
      activityByDay,
      incidentHistory,
      indexes: indexes.map(({ name, key }) => ({ name, key })),
    };
  } finally {
    await collection.deleteMany({ source: "dbms-demo", demoRunId: runId });
  }
}
