/**
 * Canonical Live contract (src/live/schema.ts): fixtures of exactly what
 * layout Live writes today must safeParse; passthrough keeps additive future
 * fields working; and the fallback file readers skip invalid items instead of
 * failing the whole read.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  VisualEditSchema,
  LiveRequestSchema,
  RequestTargetSchema,
  RequestBoxSchema,
} from "../src/live/schema.js";
import * as getRecentVisualEdits from "../src/mcp/tools/get-recent-visual-edits.js";
import * as getPendingRequests from "../src/mcp/tools/get-pending-requests.js";

let tmp: string;
let origCwd: string;

function parse(res: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(res.content[0]!.text);
}

before(async () => {
  origCwd = process.cwd();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-schema-test-"));
  process.chdir(tmp);
});

after(async () => {
  process.chdir(origCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

// --- VisualEdit -------------------------------------------------------------

test("all 8 VisualEdit kinds parse", () => {
  const kinds = [
    "class",
    "token",
    "inline-style",
    "text",
    "attribute",
    "element-swap",
    "import",
    "asset",
  ];
  for (const kind of kinds) {
    const res = VisualEditSchema.safeParse({
      id: "e1",
      timestamp: "2026-06-10T10:00:00.000Z",
      file: "src/Hero.tsx",
      line: 12,
      col: 4,
      property: "padding",
      kind,
      before: "p-4",
      after: "p-6",
    });
    assert.equal(res.success, true, `kind '${kind}' should parse`);
  }
});

test("element-swap edit with variant and beforeValue parses (what Live writes)", () => {
  const res = VisualEditSchema.safeParse({
    id: "e2",
    timestamp: "2026-06-10T10:01:00.000Z",
    file: "src/Nav.tsx",
    line: 3,
    col: 1,
    component: "Nav",
    property: "icon",
    kind: "element-swap",
    before: "ChevronRight",
    after: "ArrowRight",
    variant: "md:",
    beforeValue: { type: "icon", name: "ChevronRight", props: { size: 16 } },
  });
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.variant, "md:");
    assert.deepEqual(res.data.beforeValue, {
      type: "icon",
      name: "ChevronRight",
      props: { size: 16 },
    });
  }
});

test("unknown extra fields pass through (additive forward compat)", () => {
  const edit = VisualEditSchema.safeParse({
    id: "e3",
    timestamp: "2026-06-10T10:02:00.000Z",
    file: "src/A.tsx",
    line: 1,
    col: 1,
    property: "color",
    kind: "token",
    before: "text-gray-500",
    after: "text-muted",
    someFutureField: { nested: true },
  });
  assert.equal(edit.success, true);
  if (edit.success) {
    assert.deepEqual(
      (edit.data as Record<string, unknown>).someFutureField,
      { nested: true }
    );
  }

  const req = LiveRequestSchema.safeParse({
    id: "r0",
    timestamp: "2026-06-10T10:02:00.000Z",
    message: "hello",
    target: { kind: "general", futureTargetField: 1 },
    status: "pending",
    priority: "high", // future field
  });
  assert.equal(req.success, true);
});

test("invalid kind is rejected", () => {
  const res = VisualEditSchema.safeParse({
    id: "e4",
    timestamp: "2026-06-10T10:03:00.000Z",
    file: "src/A.tsx",
    line: 1,
    col: 1,
    property: "color",
    kind: "teleport", // not a real kind
    before: "a",
    after: "b",
  });
  assert.equal(res.success, false);
});

// --- LiveRequest / RequestTarget ---------------------------------------------

test("element, region and general LiveRequests parse", () => {
  const element = LiveRequestSchema.safeParse({
    id: "r1",
    timestamp: "2026-06-10T11:00:00.000Z",
    message: "make this the primary CTA",
    target: {
      kind: "element",
      file: "src/Hero.tsx",
      line: 12,
      col: 4,
      component: "Hero",
      classList: "btn btn-secondary",
      box: { padding: "8px 16px", width: "120px" },
    },
    status: "pending",
  });
  assert.equal(element.success, true);

  const region = LiveRequestSchema.safeParse({
    id: "r2",
    timestamp: "2026-06-10T11:01:00.000Z",
    message: "add a testimonial row here",
    target: {
      kind: "region",
      rect: { x: 0, y: 480, width: 1280, height: 320 },
      nearest: { file: "src/Home.tsx", line: 40, col: 2 },
    },
    status: "pending",
  });
  assert.equal(region.success, true);

  const general = LiveRequestSchema.safeParse({
    id: "r3",
    timestamp: "2026-06-10T11:02:00.000Z",
    message: "tighten vertical rhythm across the page",
    target: { kind: "general" },
    status: "done",
  });
  assert.equal(general.success, true);
});

test("request with history parses", () => {
  const res = LiveRequestSchema.safeParse({
    id: "r4",
    timestamp: "2026-06-10T11:03:00.000Z",
    message: "swap the hero image",
    target: { kind: "general" },
    status: "done",
    history: [
      { status: "pending", at: "2026-06-10T11:03:00.000Z" },
      { status: "done", at: "2026-06-10T11:30:00.000Z" },
    ],
  });
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.history?.length, 2);
    assert.equal(res.data.history?.[0]?.status, "pending");
  }
});

test("RequestTargetSchema rejects an unknown kind; RequestBox accepts extras", () => {
  assert.equal(
    RequestTargetSchema.safeParse({ kind: "viewport" }).success,
    false
  );
  assert.equal(
    RequestBoxSchema.safeParse({ padding: "4px", borderRadius: "8px" }).success,
    true
  );
});

// --- Readers skip invalid items ----------------------------------------------

test("get-recent-visual-edits skips invalid items, keeps valid ones", async () => {
  const valid = {
    id: "ok",
    timestamp: "2026-06-10T10:00:00.000Z",
    file: "src/Hero.tsx",
    line: 12,
    col: 4,
    property: "padding",
    kind: "attribute",
    before: "alt='old'",
    after: "alt='new'",
  };
  const invalid = { id: "bad", file: "src/Hero.tsx" }; // missing most fields
  await fs.mkdir(path.join(tmp, ".layout", "live"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, ".layout", "live", "recent-edits.json"),
    JSON.stringify({ version: 1, edits: [invalid, valid, 42, null] }),
    "utf8"
  );

  const out = parse(await getRecentVisualEdits.handler()({}));
  assert.equal(out.source, "edit-log-file");
  assert.equal(out.edits.length, 1);
  assert.equal(out.edits[0].id, "ok");
  assert.equal(out.warnings, undefined, "no warnings for version 1");
});

test("get-pending-requests skips invalid items, keeps valid ones", async () => {
  const valid = {
    id: "ok",
    timestamp: "2026-06-10T11:00:00.000Z",
    message: "fix this",
    target: { kind: "element", file: "src/Hero.tsx", line: 1, col: 1 },
    status: "pending",
  };
  const invalid = { id: "bad", message: "no target/status" };
  await fs.mkdir(path.join(tmp, ".layout", "live"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, ".layout", "live", "requests.json"),
    JSON.stringify({ version: 1, requests: [invalid, valid] }),
    "utf8"
  );

  const out = parse(await getPendingRequests.handler()({}));
  assert.equal(out.source, "requests-file");
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].id, "ok");
  assert.equal(out.warnings, undefined, "no warnings for version 1");
});

// --- Version handling ----------------------------------------------------------

test("a future schema version yields a warning, not a silent empty result", async () => {
  const edit = {
    id: "v2-edit",
    timestamp: "2026-06-10T10:00:00.000Z",
    file: "src/Hero.tsx",
    line: 12,
    col: 4,
    property: "padding",
    kind: "class",
    before: "p-4",
    after: "p-6",
  };
  await fs.mkdir(path.join(tmp, ".layout", "live"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, ".layout", "live", "recent-edits.json"),
    JSON.stringify({ version: 2, edits: [edit] }),
    "utf8"
  );
  const edits = parse(await getRecentVisualEdits.handler()({}));
  assert.equal(edits.edits.length, 1, "still reads compatible entries");
  assert.equal(edits.warnings?.length, 1);
  assert.match(edits.warnings[0], /schema version 2/);
  assert.match(edits.warnings[0], /upgrade @layoutdesign\/context/);

  const request = {
    id: "v2-req",
    timestamp: "2026-06-10T11:00:00.000Z",
    message: "fix this",
    target: { kind: "general" },
    status: "pending",
  };
  await fs.writeFile(
    path.join(tmp, ".layout", "live", "requests.json"),
    JSON.stringify({ version: 3, requests: [request] }),
    "utf8"
  );
  const requests = parse(await getPendingRequests.handler()({}));
  assert.equal(requests.requests.length, 1);
  assert.match(requests.warnings[0], /schema version 3/);
});

test("legacy bare-array files still parse without warnings", async () => {
  await fs.mkdir(path.join(tmp, ".layout", "live"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, ".layout", "live", "recent-edits.json"),
    JSON.stringify([
      {
        id: "legacy",
        timestamp: "2026-06-10T10:00:00.000Z",
        file: "src/A.tsx",
        line: 1,
        col: 1,
        property: "color",
        kind: "class",
        before: "a",
        after: "b",
      },
    ]),
    "utf8"
  );
  const out = parse(await getRecentVisualEdits.handler()({}));
  assert.equal(out.edits.length, 1);
  assert.equal(out.warnings, undefined);
});
