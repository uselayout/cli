/**
 * File-based write-lock coordination between Claude Code (via the MCP tools)
 * and the layout Live desktop app.
 *
 * Locks live in `.layout/live/locks.json` at the project root (gitignored by
 * default). Both Live and these MCP handlers mutate that file, so every
 * read-modify-write is wrapped in a `proper-lockfile` advisory lock for
 * atomicity. Stale locks (past `expires_at`) are taken over automatically with
 * a warning logged to stderr.
 *
 * The file-based design means Claude's `lock-file` MCP call does not have to
 * wait on IPC to a desktop app — it works even when Live's socket is slow or
 * Live isn't running at all.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import lockfile from "proper-lockfile";

export type LockHolder = "live" | "claude" | string;

export interface LockEntry {
  holder: LockHolder;
  lock_id: string;
  acquired_at: string;
  expires_at: string;
  reason?: string;
}

export type LocksFile = Record<string, LockEntry>;

export type AcquireResult =
  | { acquired: true; lock_id: string; expires_at: string }
  | { acquired: false; current_holder: LockHolder; expires_at: string };

const LIVE_DIR = path.join(".layout", "live");
const LOCKS_FILE = "locks.json";

function locksPath(projectRoot: string): string {
  return path.join(projectRoot, LIVE_DIR, LOCKS_FILE);
}

async function ensureLocksFile(projectRoot: string): Promise<string> {
  const file = locksPath(projectRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "{}\n", "utf8");
  }
  return file;
}

async function readLocksFile(file: string): Promise<LocksFile> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as LocksFile) : {};
  } catch {
    return {};
  }
}

async function writeLocksFile(file: string, locks: LocksFile): Promise<void> {
  await fs.writeFile(file, JSON.stringify(locks, null, 2) + "\n", "utf8");
}

/**
 * Run `fn` against the locks file while holding an exclusive advisory lock on
 * it, so concurrent Live + MCP writers never interleave a read-modify-write.
 */
async function withLocksFile<T>(
  projectRoot: string,
  fn: (locks: LocksFile) => { result: T; locks: LocksFile } | Promise<{ result: T; locks: LocksFile }>
): Promise<T> {
  const file = await ensureLocksFile(projectRoot);
  const release = await lockfile.lock(file, {
    retries: { retries: 10, factor: 1.5, minTimeout: 20, maxTimeout: 200 },
    stale: 10_000,
    realpath: false,
  });
  try {
    const current = await readLocksFile(file);
    const { result, locks } = await fn(current);
    await writeLocksFile(file, locks);
    return result;
  } finally {
    await release();
  }
}

function isExpired(entry: LockEntry, now: number): boolean {
  const expiry = Date.parse(entry.expires_at);
  return Number.isNaN(expiry) || expiry <= now;
}

/**
 * Acquire (or take over an expired) write lock for `relPath`.
 *
 * Returns `{ acquired: false, current_holder, expires_at }` when a live,
 * unexpired lock is already held by someone else.
 */
export async function acquireLock(
  projectRoot: string,
  opts: {
    path: string;
    ttlSeconds: number;
    reason?: string;
    holder?: LockHolder;
  }
): Promise<AcquireResult> {
  const holder: LockHolder = opts.holder ?? "claude";
  return withLocksFile<AcquireResult>(projectRoot, (locks) => {
    const now = Date.now();
    const existing = locks[opts.path];

    if (existing && !isExpired(existing, now)) {
      return {
        result: {
          acquired: false,
          current_holder: existing.holder,
          expires_at: existing.expires_at,
        },
        locks,
      };
    }

    if (existing && isExpired(existing, now)) {
      console.warn(
        `[layout-context] Taking over stale lock on "${opts.path}" ` +
          `(was held by "${existing.holder}", expired ${existing.expires_at})`
      );
    }

    const lockId = crypto.randomUUID();
    const acquiredAt = new Date(now).toISOString();
    const expiresAt = new Date(now + opts.ttlSeconds * 1000).toISOString();
    const entry: LockEntry = {
      holder,
      lock_id: lockId,
      acquired_at: acquiredAt,
      expires_at: expiresAt,
      ...(opts.reason ? { reason: opts.reason } : {}),
    };

    return {
      result: { acquired: true, lock_id: lockId, expires_at: expiresAt },
      locks: { ...locks, [opts.path]: entry },
    };
  });
}

/**
 * Release a lock by its `lock_id`. Only the matching entry is removed, so a
 * stale `lock_id` from a since-taken-over lock cannot evict the new holder.
 */
export async function releaseLock(
  projectRoot: string,
  lockId: string
): Promise<{ released: boolean }> {
  return withLocksFile<{ released: boolean }>(projectRoot, (locks) => {
    const entry = Object.entries(locks).find(
      ([, v]) => v.lock_id === lockId
    );
    if (!entry) {
      return { result: { released: false }, locks };
    }
    const next = { ...locks };
    delete next[entry[0]];
    return { result: { released: true }, locks: next };
  });
}

/** Read the current locks map (best-effort; empty if file absent/corrupt). */
export async function readLocks(projectRoot: string): Promise<LocksFile> {
  const file = locksPath(projectRoot);
  return readLocksFile(file);
}
