import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Compatibility entry point; the canonical migration implementation lives in scripts/migrate.mjs. */
export async function runMigrations(): Promise<string[]> {
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    env: process.env,
  });
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Applied "))
    .map((line) => line.slice("Applied ".length));
}
