import "server-only";

import { Collection, Db, Document, MongoClient } from "mongodb";
import { getServerEnv } from "@/lib/server-env";

const globalForMongo = globalThis as typeof globalThis & {
  mongoClientPromise?: Promise<MongoClient>;
  incidentEventsCollectionPromise?: Promise<Collection<Document>>;
};

export async function getMongoDatabase(): Promise<Db> {
  const { MONGODB_URI, MONGODB_DB_NAME } = getServerEnv();
  const clientPromise =
    globalForMongo.mongoClientPromise ??
    new MongoClient(MONGODB_URI, { maxPoolSize: 10 }).connect();

  if (process.env.NODE_ENV !== "production") {
    globalForMongo.mongoClientPromise = clientPromise;
  }

  return (await clientPromise).db(MONGODB_DB_NAME);
}

/** Create the event collection and its query/idempotency indexes on first use. */
export async function getIncidentEventsCollection(): Promise<Collection<Document>> {
  if (!globalForMongo.incidentEventsCollectionPromise) {
    globalForMongo.incidentEventsCollectionPromise = getMongoDatabase().then(async (db) => {
      const collection = db.collection("incident_events");
      await collection.createIndex({ eventId: 1 }, { unique: true });
      await collection.createIndex({ incidentId: 1, occurredAt: -1 });
      return collection;
    });
  }
  return globalForMongo.incidentEventsCollectionPromise;
}
