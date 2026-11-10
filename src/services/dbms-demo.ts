import "server-only";

import { runPostgresDbmsDemo } from "@/repositories/dbms-demo";
import { runMongoDbmsDemo } from "@/repositories/mongodb-demo";

export async function runDbmsDemo() {
  const postgres = await runPostgresDbmsDemo();
  const mongodb = await runMongoDbmsDemo(postgres.incidentId);
  return { postgres, mongodb };
}
