/**
 * Socket-absent (Live not running) fallback behaviour.
 *
 * No Live app runs in CI, so connectToLive() resolves to null. These tests
 * verify the graceful paths: get-selected-element → { running: false };
 * get-recent-visual-edits → reads .layout/live/recent-edits.json with
 * source 'edit-log-file'; check-setup's getLiveStatus → { running: false }.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as getSelectedElement from "../src/mcp/tools/get-selected-element.js";
import * as getRecentVisualEdits from "../src/mcp/tools/get-recent-visual-edits.js";
import { getLiveStatus } from "../src/mcp/tools/check-setup.js";

let tmp: string;
let origCwd: string;

function parse(res: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(res.content[0]!.text);
}

before(async () => {
  origCwd = process.cwd();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-live-test-"));
  process.chdir(tmp);
});

after(async () => {
  process.chdir(origCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("get-selected-element returns { running: false } when Live absent", async () => {
  const out = parse(await getSelectedElement.handler()());
  assert.deepEqual(out, { running: false });
});

test("get-recent-visual-edits falls back to the on-disk edit log", async () => {
  const edits = [
    {
      id: "1",
      timestamp: "2026-05-16T10:00:00.000Z",
      file: "src/Hero.tsx",
      line: 12,
      col: 4,
      property: "padding",
      kind: "class",
      before: "p-4",
      after: "p-6",
    },
    {
      id: "2",
      timestamp: "2026-05-16T11:00:00.000Z",
      file: "src/Nav.tsx",
      line: 3,
      col: 1,
      property: "bg-color",
      kind: "token",
      before: "bg-white",
      after: "bg-surface",
    },
  ];
  await fs.mkdir(path.join(tmp, ".layout", "live"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, ".layout", "live", "recent-edits.json"),
    JSON.stringify(edits),
    "utf8"
  );

  const all = parse(await getRecentVisualEdits.handler()({}));
  assert.equal(all.source, "edit-log-file");
  assert.equal(all.edits.length, 2);
  assert.equal(all.edits[0].id, "2", "most recent first");
  assert.equal(all.truncated, false);

  const filtered = parse(
    await getRecentVisualEdits.handler()({ file: "src/Hero.tsx" })
  );
  assert.equal(filtered.edits.length, 1);
  assert.equal(filtered.edits[0].file, "src/Hero.tsx");

  const limited = parse(await getRecentVisualEdits.handler()({ limit: 1 }));
  assert.equal(limited.edits.length, 1);
  assert.equal(limited.truncated, true);

  const sinceFiltered = parse(
    await getRecentVisualEdits.handler()({ since: "2026-05-16T10:30:00.000Z" })
  );
  assert.equal(sinceFiltered.edits.length, 1);
  assert.equal(sinceFiltered.edits[0].id, "2");
});

test("get-recent-visual-edits returns empty set when no log exists", async () => {
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "layout-live-empty-"));
  process.chdir(empty);
  try {
    const out = parse(await getRecentVisualEdits.handler()({}));
    assert.equal(out.source, "edit-log-file");
    assert.deepEqual(out.edits, []);
    assert.equal(out.truncated, false);
  } finally {
    process.chdir(tmp);
    await fs.rm(empty, { recursive: true, force: true });
  }
});

test("getLiveStatus reports not-running when socket absent", async () => {
  const status = await getLiveStatus();
  assert.equal(status.running, false);
  assert.equal(typeof status.installed, "boolean");
  assert.equal(status.version, undefined);
});
