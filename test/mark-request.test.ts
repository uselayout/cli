/**
 * mark-request disk-fallback behaviour (Live not running).
 *
 * No Live app runs in CI, so connectToLive() resolves to null and the tool
 * edits `.layout/live/requests.json` directly: status flip, agent-authored
 * history entry (actor + note), atomic write, and a helpful not-found
 * message listing the open ids. get-pending-requests must then surface the
 * "in-progress" entry as still-open work.
 */
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as markRequest from "../src/mcp/tools/mark-request.js";
import * as getPendingRequests from "../src/mcp/tools/get-pending-requests.js";

const origCwd = process.cwd();
let tmp: string;

function parseText(res: { content: Array<{ type: string; text: string }> }) {
  return res.content[0]!.text;
}

const REQUESTS = [
  {
    id: "r1",
    timestamp: "2026-07-01T10:00:00.000Z",
    message: "make this the primary CTA",
    target: { kind: "element", file: "src/Hero.tsx", line: 12, col: 4 },
    status: "pending",
  },
  {
    id: "r2",
    timestamp: "2026-07-01T11:00:00.000Z",
    message: "already handled",
    target: { kind: "general" },
    status: "done",
  },
];

async function writeLog(): Promise<string> {
  const file = path.join(tmp, ".layout", "live", "requests.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ version: 1, requests: REQUESTS }, null, 2),
    "utf8"
  );
  return file;
}

async function readLog(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8")) as {
    version: number;
    requests: Array<{
      id: string;
      status: string;
      history?: Array<{ status: string; at: string; actor?: string; note?: string }>;
    }>;
  };
}

beforeEach(async () => {
  process.chdir(origCwd);
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-mark-req-"));
  process.chdir(tmp);
});

after(async () => {
  process.chdir(origCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("mark-request flips status on disk and appends an agent history entry", async () => {
  const file = await writeLog();

  const started = parseText(
    await markRequest.handler()({ id: "r1", status: "in-progress" })
  );
  assert.match(started, /Marked request r1 as in-progress/);
  assert.match(started, /requests\.json/);

  const done = parseText(
    await markRequest.handler()({
      id: "r1",
      status: "done",
      note: "swapped the CTA variant",
    })
  );
  assert.match(done, /Marked request r1 as done/);
  assert.match(done, /swapped the CTA variant/);

  const log = await readLog(file);
  assert.equal(log.version, 1, "format stays version 1");
  const r1 = log.requests.find((r) => r.id === "r1")!;
  assert.equal(r1.status, "done");
  assert.equal(r1.history!.length, 2);
  assert.deepEqual(
    r1.history!.map((h) => ({ status: h.status, actor: h.actor, note: h.note })),
    [
      { status: "in-progress", actor: "agent", note: undefined },
      { status: "done", actor: "agent", note: "swapped the CTA variant" },
    ]
  );
  for (const h of r1.history!) {
    assert.equal(Number.isNaN(Date.parse(h.at)), false, "ISO timestamps");
  }
  // The untouched request is preserved verbatim.
  assert.equal(log.requests.find((r) => r.id === "r2")!.status, "done");
});

test("mark-request reports unknown ids with the open ids", async () => {
  await writeLog();
  const res = await markRequest.handler()({ id: "nope", status: "done" });
  assert.equal(res.isError, true);
  const text = parseText(res);
  assert.match(text, /No request with id "nope"/);
  assert.match(text, /Open request ids: r1/);
  assert.doesNotMatch(text, /r2/, "done requests are not offered");
});

test("mark-request with no log reports there is nothing to mark", async () => {
  const res = await markRequest.handler()({ id: "r1", status: "done" });
  assert.equal(res.isError, true);
  assert.match(parseText(res), /no open requests/i);
});

test("get-pending-requests still lists an in-progress request (with status)", async () => {
  await writeLog();
  await markRequest.handler()({ id: "r1", status: "in-progress" });

  const out = JSON.parse(parseText(await getPendingRequests.handler()({})));
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].id, "r1");
  assert.equal(out.requests[0].status, "in-progress");
});
