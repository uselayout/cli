/**
 * live discovery + rebind:
 *  - tag-aware probe prefers THIS project's (Layout-tagged) server and asks
 *    instead of grabbing the first open port;
 *  - an already-open Live is re-bound to the new dev URL (set-dev-url) rather
 *    than no-opping into focus-only.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverDevUrl, liveOpenCommand } from "../src/cli/live-open.js";
import { liveSocketPath } from "../src/mcp/tools/_live-socket.js";

// ─── discoverDevUrl (injected probes; no real network) ──────────────────────

test("single responder is used directly", async () => {
  const url = await discoverDevUrl({
    ports: [3000, 5173],
    responds: async (u) => u.endsWith(":3000"),
    hasTags: async () => false,
    prompt: async () => "PROMPTED",
  });
  assert.equal(url, "http://localhost:3000");
});

test("prefers the Layout-tagged server over a bare responder, no prompt", async () => {
  let prompted = false;
  const url = await discoverDevUrl({
    ports: [5173, 3001],
    responds: async () => true, // both up
    hasTags: async (u) => u.endsWith(":3001"), // only ours is tagged
    prompt: async () => {
      prompted = true;
      return "PROMPTED";
    },
  });
  assert.equal(url, "http://localhost:3001");
  assert.equal(prompted, false);
});

test("ambiguous (multiple untagged) → asks the user", async () => {
  const url = await discoverDevUrl({
    ports: [5173, 3000],
    responds: async () => true,
    hasTags: async () => false,
    prompt: async (urls) => urls[1] ?? null,
  });
  assert.equal(url, "http://localhost:3000");
});

test("no responders → null", async () => {
  const url = await discoverDevUrl({
    ports: [3000],
    responds: async () => false,
  });
  assert.equal(url, null);
});

// ─── rebind: --port re-points an already-open Live ──────────────────────────

let server: net.Server | null = null;
let httpServer: http.Server | null = null;
let sockPath = "";
let dir = "";

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
  server = null;
  httpServer = null;
  if (sockPath) await fs.rm(sockPath, { force: true }).catch(() => {});
  if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  sockPath = "";
  dir = "";
});

test("running Live is re-bound via set-dev-url then focus", async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rebind-"));

  // A dev server that responds so the dev-info URL is accepted.
  httpServer = http.createServer((_req, res) => res.end("ok"));
  const port = await new Promise<number>((r) =>
    httpServer!.listen(0, () => r((httpServer!.address() as net.AddressInfo).port))
  );
  const devUrl = `http://localhost:${port}`;

  // dev-info.json binds this project to that dev server.
  await fs.mkdir(path.join(dir, ".layout", "live"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".layout", "live", "dev-info.json"),
    JSON.stringify({ projectRoot: dir, url: devUrl })
  );

  // Fake "already-open Live" socket that records the methods it receives.
  sockPath = liveSocketPath(dir);
  await fs.mkdir(path.dirname(sockPath), { recursive: true });
  await fs.rm(sockPath, { force: true }).catch(() => {});
  const methods: string[] = [];
  let reboundUrl = "";
  server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as {
          id: string;
          method: string;
          params?: { url?: string };
        };
        methods.push(msg.method);
        if (msg.method === "set-dev-url") reboundUrl = msg.params?.url ?? "";
        sock.write(JSON.stringify({ id: msg.id, ok: true, result: {} }) + "\n");
      }
    });
  });
  await new Promise<void>((r) => server!.listen(sockPath, () => r()));

  // setup:false → skip the source-tag preflight (no plugin work in this test).
  await liveOpenCommand(dir, { setup: false });

  assert.deepEqual(methods, ["set-dev-url", "focus"]);
  assert.equal(reboundUrl, devUrl);
});
