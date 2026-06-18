/**
 * Lightweight "update available" check for the CLI.
 *
 * Runs after a command (and once at `serve` startup), throttled to once per day
 * via a temp-file cache, with a short network timeout. Fail-silent: offline, a
 * slow registry, or any error just skips the notice — it never blocks or breaks
 * a command. The notice goes to STDERR only, so it can't corrupt the MCP stdio
 * JSON-RPC stream on `serve` or `--json` command output on stdout.
 *
 * Disable with `LAYOUT_NO_UPDATE_CHECK=1` (also skipped under `CI`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";

const PKG = "@layoutdesign/context";
const CACHE_FILE = path.join(os.tmpdir(), "layout-context-update.json");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

interface UpdateCache {
  checkedAt: number;
  latest: string | null;
}

export interface UpdateInfo {
  current: string;
  latest: string;
}

/** Numeric semver-ish compare (ignores prerelease tags). >0 ⇒ a newer than b. */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    (v.split("-")[0] ?? "").split(".").map((n) => Number(n) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    /* a read-only tmp dir just means we re-check next time — fine */
  }
}

/** The latest published version from the npm registry, or null on any failure. */
async function fetchLatest(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`https://registry.npmjs.org/${PKG}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * Returns update info when a newer version is published, else null. Throttled
 * to one network check per day (cached); never throws.
 */
export async function checkForUpdate(current: string): Promise<UpdateInfo | null> {
  if (process.env.LAYOUT_NO_UPDATE_CHECK || process.env.CI) return null;

  const cache = readCache();
  let latest = cache?.latest ?? null;
  const fresh = cache != null && Date.now() - cache.checkedAt < ONE_DAY_MS;
  if (!fresh) {
    latest = await fetchLatest();
    writeCache({ checkedAt: Date.now(), latest });
  }

  if (latest && compareVersions(latest, current) > 0) {
    return { current, latest };
  }
  return null;
}

/** Print the "update available" notice to stderr (never stdout). */
export function printUpdateNotice(info: UpdateInfo): void {
  const lines = [
    "",
    chalk.dim("  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄"),
    `  ${chalk.bold("Layout update available")}  ${chalk.dim(info.current)} → ${chalk.green(info.latest)}`,
    `  ${chalk.cyan(`npm i -D ${PKG}@latest`)}${chalk.dim("  then restart your dev server")}`,
    chalk.dim("  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄"),
    "",
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

/** Convenience: check + print in one call (fail-silent). */
export async function notifyIfUpdate(current: string): Promise<void> {
  try {
    const info = await checkForUpdate(current);
    if (info) printUpdateNotice(info);
  } catch {
    /* never let the update check affect the command */
  }
}
