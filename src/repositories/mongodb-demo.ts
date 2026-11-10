import "server-only";

import { getIncidentEventsCollection } from "@/db/mongodb";
import { runMongoDbmsOperations } from "../../scripts/mongodb-demo-core.mjs";

export async function runMongoDbmsDemo(incidentId: number) {
  const collection = await getIncidentEventsCollection();
  return runMongoDbmsOperations(collection, incidentId);
}
