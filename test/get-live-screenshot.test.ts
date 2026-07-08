/**
 * get-live-screenshot tool behaviour (no Live app runs in CI):
 *
 * - `requestId` reads `.layout/live/screenshots/<id>.png` from disk and
 *   returns it as MCP image content (base64 + image/png); works with Live
 *   closed.
 * - Unknown ids / traversal-shaped ids get a clear text error, never an fs hit
 *   outside the screenshots dir.
 * - No `requestId` with Live not running is a clear "not running" error (the
 *   socket for a fresh tmp cwd never exists).
 * - `get-pending-requests` surfaces the `screenshot` field and a hint pointing
 *   at this tool.
 * - The canonical LiveRequestSchema accepts the additive `screenshot` field.
 */
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as getLiveScreenshot from "../src/mcp/tools/get-live-screenshot.js";
import * as getPendingRequests from "../src/mcp/tools/get-pending-requests.js";
import { LiveRequestSchema } from "../src/live/schema.js";

const origCwd = process.cwd();
let tmp: string;

// Tiny but real PNG header + payload: content is irrelevant, bytes must
// round-trip exactly.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("layout-live-test-screenshot"),
]);

type ToolResult = {
  isError?: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
};

function textOf(res: ToolResult): string {
  const t = res.content.find((c) => c.type === "text");
  return t && t.type === "text" ? t.text : "";
}

function imageOf(res: ToolResult) {
  const i = res.content.find((c) => c.type === "image");
  return i && i.type === "image" ? i : null;
}

async function writeScreenshot(id: string): Promise<void> {
  const dir = path.join(tmp, ".layout", "live", "screenshots");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.png`), PNG_BYTES);
}

beforeEach(async () => {
  process.chdir(origCwd);
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-live-shot-"));
  process.chdir(tmp);
});

after(async () => {
  process.chdir(origCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("requestId returns the stored PNG as MCP image content", async () => {
  await writeScreenshot("r1");
  const res = (await getLiveScreenshot.handler()({
    requestId: "r1",
  })) as ToolResult;

  assert.notEqual(res.isError, true, "stored screenshot is not an error");
  const image = imageOf(res);
  assert.ok(image, "returns an image content block");
  assert.equal(image!.mimeType, "image/png");
  assert.equal(image!.data, PNG_BYTES.toString("base64"), "bytes round-trip");
  assert.match(textOf(res), /request r1/);
});

test("unknown requestId is a clear text error", async () => {
  const res = (await getLiveScreenshot.handler()({
    requestId: "missing",
  })) as ToolResult;
  assert.equal(res.isError, true);
  assert.match(textOf(res), /No screenshot stored for request missing/);
  assert.match(textOf(res), /get-pending-requests/);
});

test("traversal-shaped requestId is rejected before touching the fs", async () => {
  const res = (await getLiveScreenshot.handler()({
    requestId: "../../etc/passwd",
  })) as ToolResult;
  assert.equal(res.isError, true);
  assert.match(textOf(res), /Invalid requestId/);
});

test("no requestId with Live not running is a clear error", async () => {
  process.env.LAYOUT_LIVE_CONNECT_TIMEOUT_MS = "200";
  try {
    const res = (await getLiveScreenshot.handler()({})) as ToolResult;
    assert.equal(res.isError, true);
    assert.match(textOf(res), /layout Live is not running/);
    assert.match(textOf(res), /requestId/);
  } finally {
    delete process.env.LAYOUT_LIVE_CONNECT_TIMEOUT_MS;
  }
});

test("get-pending-requests surfaces screenshot fields and a viewing hint", async () => {
  const file = path.join(tmp, ".layout", "live", "requests.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 1,
      requests: [
        {
          id: "r1",
          timestamp: "2026-07-01T10:00:00.000Z",
          message: "make this match the mockup",
          target: { kind: "element", file: "src/Hero.tsx", line: 12, col: 4 },
          status: "pending",
          screenshot: "screenshots/r1.png",
        },
        {
          id: "r2",
          timestamp: "2026-07-01T11:00:00.000Z",
          message: "no screenshot on this one",
          target: { kind: "general" },
          status: "pending",
        },
      ],
    }),
    "utf8"
  );

  const res = (await getPendingRequests.handler()({})) as ToolResult;
  const parsed = JSON.parse(textOf(res));
  const r1 = parsed.requests.find((r: { id: string }) => r.id === "r1");
  assert.equal(r1.screenshot, "screenshots/r1.png");
  assert.match(parsed.screenshotHint, /get-live-screenshot/);
});

test("get-pending-requests omits the hint when nothing has a screenshot", async () => {
  const file = path.join(tmp, ".layout", "live", "requests.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 1,
      requests: [
        {
          id: "r2",
          timestamp: "2026-07-01T11:00:00.000Z",
          message: "plain request",
          target: { kind: "general" },
          status: "pending",
        },
      ],
    }),
    "utf8"
  );
  const res = (await getPendingRequests.handler()({})) as ToolResult;
  const parsed = JSON.parse(textOf(res));
  assert.equal(parsed.screenshotHint, undefined);
});

test("LiveRequestSchema accepts the additive screenshot field", () => {
  const res = LiveRequestSchema.safeParse({
    id: "r1",
    timestamp: "2026-07-01T10:00:00.000Z",
    message: "make this match the mockup",
    target: { kind: "general" },
    status: "pending",
    screenshot: "screenshots/r1.png",
  });
  assert.equal(res.success, true);
  assert.equal(
    res.success ? (res.data as { screenshot?: string }).screenshot : undefined,
    "screenshots/r1.png"
  );
});
