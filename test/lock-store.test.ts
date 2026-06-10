/**
 * Lock store: acquire / release / conflict / expiry-takeover.
 *
 * Exercises the proper-lockfile-backed .layout/live/locks.json store directly,
 * and the lock-file / unlock-file tool handlers end-to-end.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acquireLock,
  releaseLock,
  readLocks,
} from "../src/mcp/live-lock-store.js";
import * as lockFile from "../src/mcp/tools/lock-file.js";
import * as unlockFile from "../src/mcp/tools/unlock-file.js";

let tmp: string;
let origCwd: string;

before(async () => {
  origCwd = process.cwd();
});
after(() => {
  process.chdir(origCwd);
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-lock-test-"));
});

test("acquireLock grants a fresh lock", async () => {
  const res = await acquireLock(tmp, { path: "src/A.tsx", ttlSeconds: 60 });
  assert.equal(res.acquired, true);
  if (res.acquired) {
    assert.match(res.lock_id, /[0-9a-f-]{36}/);
    const locks = await readLocks(tmp);
    assert.equal(locks["src/A.tsx"]!.lock_id, res.lock_id);
    assert.equal(locks["src/A.tsx"]!.holder, "claude");
  }
});

test("a second acquire on a held, unexpired path conflicts", async () => {
  await acquireLock(tmp, {
    path: "src/B.tsx",
    ttlSeconds: 60,
    holder: "live",
    reason: "user dragging slider",
  });
  const res = await acquireLock(tmp, { path: "src/B.tsx", ttlSeconds: 60 });
  assert.equal(res.acquired, false);
  if (!res.acquired) {
    assert.equal(res.current_holder, "live");
    assert.ok(Date.parse(res.expires_at) > Date.now());
  }
});

test("releaseLock only removes the matching lock_id", async () => {
  const a = await acquireLock(tmp, { path: "src/C.tsx", ttlSeconds: 60 });
  assert.equal(a.acquired, true);
  if (!a.acquired) return;

  const wrong = await releaseLock(tmp, "not-the-id");
  assert.equal(wrong.released, false);
  assert.ok((await readLocks(tmp))["src/C.tsx"], "lock still held");

  const right = await releaseLock(tmp, a.lock_id);
  assert.equal(right.released, true);
  assert.equal((await readLocks(tmp))["src/C.tsx"], undefined);
});

test("an expired lock is taken over with a warning", async () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const first = await acquireLock(tmp, {
      path: "src/D.tsx",
      ttlSeconds: 60,
      holder: "live",
    });
    assert.equal(first.acquired, true);

    // Force-expire the lock on disk.
    const locksPath = path.join(tmp, ".layout", "live", "locks.json");
    const locks = JSON.parse(await fs.readFile(locksPath, "utf8"));
    locks["src/D.tsx"].expires_at = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(locksPath, JSON.stringify(locks), "utf8");

    const takeover = await acquireLock(tmp, {
      path: "src/D.tsx",
      ttlSeconds: 60,
      holder: "claude",
    });
    assert.equal(takeover.acquired, true);
    if (takeover.acquired) {
      const after = await readLocks(tmp);
      assert.equal(after["src/D.tsx"]!.holder, "claude");
      assert.equal(after["src/D.tsx"]!.lock_id, takeover.lock_id);
    }
    assert.ok(
      warnings.some((w) => w.includes("stale lock") && w.includes("src/D.tsx")),
      "a stale-takeover warning was logged"
    );
  } finally {
    console.warn = origWarn;
  }
});

test("two simultaneous acquires on the same path: exactly one wins", async () => {
  const [a, b] = await Promise.all([
    acquireLock(tmp, { path: "src/F.tsx", ttlSeconds: 60, holder: "claude" }),
    acquireLock(tmp, { path: "src/F.tsx", ttlSeconds: 60, holder: "live" }),
  ]);
  const wins = [a, b].filter((r) => r.acquired);
  assert.equal(wins.length, 1, "exactly one of the two concurrent acquires won");

  // The on-disk store holds exactly the winner's lock.
  const locks = await readLocks(tmp);
  const held = locks["src/F.tsx"];
  assert.ok(held, "a lock is held");
  const winner = wins[0]!;
  if (winner.acquired) {
    assert.equal(held!.lock_id, winner.lock_id);
  }
});

test("lock-file / unlock-file handlers round-trip via cwd", async () => {
  process.chdir(tmp);
  const acquired = JSON.parse(
    (await lockFile.handler()({ path: "src/E.tsx", ttl_seconds: 30 }))
      .content[0]!.text
  );
  assert.equal(acquired.acquired, true);

  const conflict = JSON.parse(
    (await lockFile.handler()({ path: "src/E.tsx" })).content[0]!.text
  );
  assert.equal(conflict.acquired, false);
  assert.equal(conflict.current_holder, "claude");

  const released = JSON.parse(
    (await unlockFile.handler()({ lock_id: acquired.lock_id })).content[0]!.text
  );
  assert.equal(released.released, true);
});
