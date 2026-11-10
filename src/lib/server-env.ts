import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.url(),
  MONGODB_URI: z.url(),
  MONGODB_DB_NAME: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default("sera_session"),
});

export function getServerEnv() {
  return serverEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME ?? "emergency_ops",
    SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME,
  });
}
