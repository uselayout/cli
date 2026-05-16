/**
 * Shared Unix-socket client for talking to a running layout Live desktop app.
 *
 * Live hosts a line-delimited JSON socket at `~/.layout/live-<projectId>.sock`
 * (or `\\.\pipe\layout-live-<projectId>` on Windows) while it is open on a
 * project. The MCP tool handlers in this directory connect to it on demand to
 * query selection / edit / status state.
 *
 * If Live is not running the socket file is absent: `connectToLive()` resolves
 * to `null` (callers treat this as "Live not running") rather than throwing.
 */
import net from "node:net";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export interface LiveRequest {
  method: string;
  params?: Record<string, unknown>;
}

export interface LiveConnection {
  /** Send a single request and await its matching response result. */
  send<T = unknown>(req: LiveRequest): Promise<T>;
  /** Close the underlying socket. */
  close(): void;
}

/** Stable per-project id: first 16 hex chars of sha256(projectRoot). */
export function computeProjectId(projectRoot: string): string {
  return crypto
    .createHash("sha256")
    .update(path.resolve(projectRoot))
    .digest("hex")
    .slice(0, 16);
}

/** Absolute path (or Windows pipe name) of the Live socket for a project. */
export function liveSocketPath(projectRoot: string): string {
  const id = computeProjectId(projectRoot);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\layout-live-${id}`
    : path.join(os.homedir(), ".layout", `live-${id}.sock`);
}

const CONNECT_TIMEOUT_MS = 1500;
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Connect to the running Live app for `projectRoot` (defaults to cwd).
 *
 * Returns `null` — never throws — when Live is not running. "Not running" is
 * any of: socket file absent (ENOENT), stale socket (ECONNREFUSED), or the
 * connection not completing within {@link CONNECT_TIMEOUT_MS}.
 */
export async function connectToLive(
  projectRoot?: string
): Promise<LiveConnection | null> {
  const socketPath = liveSocketPath(projectRoot ?? process.cwd());

  return new Promise<LiveConnection | null>((resolve) => {
    let settled = false;
    const socket = net.createConnection(socketPath);

    const fail = (err?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      // ENOENT (no socket file) and ECONNREFUSED (stale socket) both mean
      // "Live not running". Anything else is also treated as not-running so a
      // tool call never hard-fails on a transport hiccup.
      void err;
      resolve(null);
    };

    const timer = setTimeout(() => fail({ code: "ETIMEDOUT" } as NodeJS.ErrnoException), CONNECT_TIMEOUT_MS);

    socket.once("error", (err) => {
      clearTimeout(timer);
      fail(err as NodeJS.ErrnoException);
    });

    socket.once("connect", () => {
      clearTimeout(timer);
      if (settled) {
        socket.destroy();
        return;
      }
      settled = true;
      resolve(wrapSocket(socket));
    });
  });
}

/** Wrap a connected socket in the line-delimited JSON request/response API. */
function wrapSocket(socket: net.Socket): LiveConnection {
  let buffer = "";
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: string; ok?: boolean; result?: unknown; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (!msg.id) continue;
      const waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.ok) waiter.resolve(msg.result);
      else waiter.reject(new Error(msg.error ?? "Live request failed"));
    }
  });

  const rejectAll = (err: Error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  };
  socket.on("error", (err) => rejectAll(err as Error));
  socket.on("close", () => rejectAll(new Error("Live socket closed")));

  return {
    send<T = unknown>(req: LiveRequest): Promise<T> {
      const id = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Live request timed out"));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        });
        socket.write(JSON.stringify({ id, ...req }) + "\n");
      });
    },
    close() {
      socket.destroy();
    },
  };
}
