/**
 * live-notify: silent no-op when Live isn't running; pings the socket with a
 * `notify` message when it is.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { liveNotifyCommand } from "../src/cli/live-notify.js";
import { liveSocketPath } from "../src/mcp/tools/_live-socket.js";

const origCwd = process.cwd();
let server: net.Server | null = null;
let sockPath = "";

afterEach(async () => {
  process.chdir(origCwd);
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  if (sockPath) await fs.rm(sockPath, { force: true }).catch(() => {});
});

test("silent no-op when Live is not running", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ln-off-"));
  process.chdir(dir);
  // No socket → connectToLive resolves null → command resolves, no throw.
  await assert.doesNotReject(liveNotifyCommand("src/App.tsx"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("pings a running Live socket with a notify message", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ln-on-"));
  process.chdir(dir);
  // Derive from cwd post-chdir so it matches connectToLive() exactly
  // (macOS resolves /var → /private/var, changing the project hash).
  sockPath = liveSocketPath(process.cwd());
  await fs.mkdir(path.dirname(sockPath), { recursive: true });
  await fs.rm(sockPath, { force: true }).catch(() => {});

  const received: Array<Record<string, unknown>> = [];
  server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { id: string; method: string };
        received.push(msg);
        sock.write(JSON.stringify({ id: msg.id, ok: true, result: {} }) + "\n");
      }
    });
  });
  await new Promise<void>((r) => server!.listen(sockPath, () => r()));

  await liveNotifyCommand("src/Hero.tsx");

  assert.equal(received.length, 1);
  assert.equal(received[0]!.method, "notify");
  assert.deepEqual(received[0]!.params, {
    event: "claude-edited",
    file: "src/Hero.tsx",
  });
  await fs.rm(dir, { recursive: true, force: true });
});
