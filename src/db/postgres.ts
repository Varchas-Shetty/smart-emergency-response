import "server-only";

import { Pool } from "pg";
import { getServerEnv } from "@/lib/server-env";

const globalForPostgres = globalThis as typeof globalThis & {
  postgresPool?: Pool;
};

export function getPostgresPool(): Pool {
  if (globalForPostgres.postgresPool) {
    return globalForPostgres.postgresPool;
  }

  const { DATABASE_URL } = getServerEnv();
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPostgres.postgresPool = pool;
  }

  return pool;
}
