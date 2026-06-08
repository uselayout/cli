/**
 * MCP tool: get-pending-requests
 *
 * Returns the free-text change requests the user left in layout Live — natural
 * language asks pinned to a selected element, a region, or the page ("make this
 * the primary CTA", "add a testimonial row here"). Reads from Live's socket when
 * running; falls back to the on-disk `.layout/live/requests.json` when not.
 *
 * The user actions these by saying things like "do the things I flagged in
 * Live" / "apply my requests". Each request carries its target so you know
 * exactly which element/file:line to change.
 */
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { connectToLive } from "./_live-socket.js";

export const name = "get-pending-requests";

export const description =
  "Returns the free-text change requests the user left in layout Live (desktop " +
  "app) — natural-language asks pinned to a selected element, a region, or the " +
  "page. Use this when the user says 'do the things I flagged in Live', 'apply " +
  "my requests', 'the notes I left', or you need to know what targeted changes " +
  "they want before editing. Each request includes its target (file:line / " +
  "component / region) so you can make the change in the right place. Works " +
  "even when Live is not running (reads the on-disk requests log).";

export const inputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .default(50)
    .describe("Maximum number of requests to return (most recent first)"),
  file: z
    .string()
    .optional()
    .describe("Filter to requests anchored to this file (relative to root)"),
  includeDone: z
    .boolean()
    .default(false)
    .describe("Include requests already marked done (default: pending only)"),
};

type Input = { limit?: number; file?: string; includeDone?: boolean };

export type RequestTarget =
  | {
      kind: "element";
      file: string;
      line: number;
      col: number;
      component?: string;
      classList?: string;
      box?: {
        padding?: string;
        margin?: string;
        width?: string;
        height?: string;
      };
    }
  | {
      kind: "region";
      rect: { x: number; y: number; width: number; height: number };
      nearest?: { file: string; line: number; col: number; component?: string };
    }
  | { kind: "general" };

export interface LiveRequest {
  id: string;
  timestamp: string;
  message: string;
  target: RequestTarget;
  status: "pending" | "done";
}

interface RequestsResult {
  source: "live-socket" | "requests-file";
  requests: LiveRequest[];
  truncated: boolean;
}

const REQUESTS_LOG = path.join(".layout", "live", "requests.json");

/** The file a request is anchored to (for file filtering), or null. */
function targetFileOf(req: LiveRequest): string | null {
  const t = req.target;
  if (t.kind === "element") return t.file;
  if (t.kind === "region") return t.nearest?.file ?? null;
  return null;
}

function applyFilters(
  requests: LiveRequest[],
  input: Input
): { requests: LiveRequest[]; truncated: boolean } {
  const limit = input.limit ?? 50;
  let filtered = requests;
  if (!input.includeDone) {
    filtered = filtered.filter((r) => r.status === "pending");
  }
  if (input.file) {
    filtered = filtered.filter((r) => targetFileOf(r) === input.file);
  }
  // Most recent first.
  filtered = [...filtered].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
  );
  const truncated = filtered.length > limit;
  return { requests: filtered.slice(0, limit), truncated };
}

async function readRequestsLog(projectRoot: string): Promise<LiveRequest[]> {
  try {
    const raw = await fs.readFile(path.join(projectRoot, REQUESTS_LOG), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LiveRequest[];
    if (parsed && Array.isArray(parsed.requests)) {
      return parsed.requests as LiveRequest[];
    }
    return [];
  } catch {
    return [];
  }
}

export function handler() {
  return async (input: Input) => {
    const projectRoot = process.cwd();
    const live = await connectToLive(projectRoot);

    let result: RequestsResult;
    if (live) {
      try {
        const res = await live.send<{
          requests: LiveRequest[];
          truncated: boolean;
        }>({
          method: "get-requests",
          params: {
            limit: input.limit ?? 50,
            file: input.file,
            pendingOnly: !input.includeDone,
          },
        });
        result = {
          source: "live-socket",
          requests: res?.requests ?? [],
          truncated: Boolean(res?.truncated),
        };
      } catch {
        const all = await readRequestsLog(projectRoot);
        const { requests, truncated } = applyFilters(all, input);
        result = { source: "requests-file", requests, truncated };
      } finally {
        live.close();
      }
    } else {
      const all = await readRequestsLog(projectRoot);
      const { requests, truncated } = applyFilters(all, input);
      result = { source: "requests-file", requests, truncated };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  };
}
