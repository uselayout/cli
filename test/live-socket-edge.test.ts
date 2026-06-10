/**
 * Live socket client edge cases (src/mcp/tools/_live-socket.ts):
 * partial frames (a JSON response split across writes), malformed JSON lines,
 * request timeouts (via the LAYOUT_LIVE_REQUEST_TIMEOUT_MS override), and a
 * server closing mid-request. Uses an in-process net server on the real
 * per-project socket path (derived from a tmpdir cwd, like live-notify.test).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { connectToLive, liveSocketPath } from "../src/mcp/tools/_live-socket.js";

const origCwd = process.cwd();
let tmp = "";
let server: net.Server | null = null;
let sockPath = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-sock-edge-"));
  process.chdir(tmp);
  // Derive from cwd post-chdir so it matches connectToLive() exactly
  // (macOS resolves /var → /private/var, changing the project hash).
  sockPath = liveSocketPath(process.cwd());
  await fs.mkdir(path.dirname(sockPath), { recursive: true });
  await fs.rm(sockPath, { force: true }).catch(() => {});
});

afterEach(async () => {
  process.chdir(origCwd);
  delete process.env.LAYOUT_LIVE_REQUEST_TIMEOUT_MS;
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  if (sockPath) await fs.rm(sockPath, { force: true }).catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Start a server whose connection handler receives complete request lines. */
async function startServer(
  onLine: (sock: net.Socket, msg: { id: string; method: string }) => void
): Promise<void> {
  server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        onLine(sock, JSON.parse(line) as { id: string; method: string });
      }
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server!.listen(sockPath, () => r()));
}

test("reassembles a response split across two writes (partial frames)", async () => {
  await startServer((sock, msg) => {
    const full =
      JSON.stringify({ id: msg.id, ok: true, result: { hello: "world" } }) +
      "\n";
    const cut = Math.floor(full.length / 2);
    sock.write(full.slice(0, cut));
    setTimeout(() => sock.write(full.slice(cut)), 20);
  });

  const conn = await connectToLive(process.cwd());
  assert.ok(conn, "connected to the test server");
  try {
    const result = await conn!.send<{ hello: string }>({ method: "ping" });
    assert.deepEqual(result, { hello: "world" });
  } finally {
    conn!.close();
  }
});

test("skips a malformed JSON line and still resolves on the valid response", async () => {
  await startServer((sock, msg) => {
    sock.write("{this is not json}\n");
    sock.write(
      JSON.stringify({ id: msg.id, ok: true, result: { ok: 1 } }) + "\n"
    );
  });

  const conn = await connectToLive(process.cwd());
  assert.ok(conn);
  try {
    const result = await conn!.send<{ ok: number }>({ method: "ping" });
    assert.deepEqual(result, { ok: 1 });
  } finally {
    conn!.close();
  }
});

test("times out when the server never responds (env override)", async () => {
  process.env.LAYOUT_LIVE_REQUEST_TIMEOUT_MS = "100";
  await startServer(() => {
    // Never respond.
  });

  const conn = await connectToLive(process.cwd());
  assert.ok(conn);
  const started = Date.now();
  try {
    await assert.rejects(conn!.send({ method: "ping" }), /timed out/);
    assert.ok(
      Date.now() - started < 2500,
      "honoured the 100ms override, not the 3000ms default"
    );
  } finally {
    conn!.close();
  }
});

test("rejects pending requests when the server closes mid-request", async () => {
  await startServer((sock) => {
    // Hang up without answering.
    sock.destroy();
  });

  const conn = await connectToLive(process.cwd());
  assert.ok(conn);
  try {
    await assert.rejects(conn!.send({ method: "ping" }));
  } finally {
    conn!.close();
  }
});

test("invalid env override falls back to the default timeout", async () => {
  process.env.LAYOUT_LIVE_REQUEST_TIMEOUT_MS = "not-a-number";
  await startServer((sock, msg) => {
    // Respond after 200ms — would fail if the invalid override parsed as 0/NaN.
    setTimeout(() => {
      sock.write(JSON.stringify({ id: msg.id, ok: true, result: {} }) + "\n");
    }, 200);
  });

  const conn = await connectToLive(process.cwd());
  assert.ok(conn);
  try {
    const result = await conn!.send({ method: "ping" });
    assert.deepEqual(result, {});
  } finally {
    conn!.close();
  }
});
