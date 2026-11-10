import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getPostgresPool } from "@/db/postgres";
import { getServerEnv } from "@/lib/server-env";

export type Actor = { user_id: number; username: string; role_name: "ADMIN" | "HOSPITAL_STAFF"; hospital_id: number | null };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 12);
  await getPostgresPool().query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)", [userId, digest(token), expires]);
  const { SESSION_COOKIE_NAME } = getServerEnv();
  (await cookies()).set(SESSION_COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

export async function getActor(): Promise<Actor | null> {
  const { SESSION_COOKIE_NAME } = getServerEnv();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const result = await getPostgresPool().query<Actor>(`SELECT u.user_id,u.username,r.role_name,u.hospital_id FROM sessions s JOIN users u USING(user_id) JOIN roles r USING(role_id) WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active`, [digest(token)]);
  return result.rows[0] ?? null;
}

export async function revokeSession() {
  const { SESSION_COOKIE_NAME } = getServerEnv();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) await getPostgresPool().query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
  jar.delete(SESSION_COOKIE_NAME);
}

export function hospitalFilter(actor: Actor, parameter = 1) {
  return actor.role_name === "ADMIN" ? { sql: "", values: [] as number[] } : { sql: ` AND hospital_id=$${parameter}`, values: [actor.hospital_id!] };
}
