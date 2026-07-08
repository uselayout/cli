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
import path from "node:path";
import { connectToLive } from "./_live-socket.js";
import { readLiveLog } from "./_live-log.js";
import { LiveRequestSchema, type LiveRequest } from "../../live/schema.js";

export const name = "get-pending-requests";

export const description =
  "Returns the free-text change requests the user left in layout Live (desktop " +
  "app) — natural-language asks pinned to a selected element, a region, or the " +
  "page. Use this when the user says 'do the things I flagged in Live', 'apply " +
  "my requests', 'the notes I left', or you need to know what targeted changes " +
  "they want before editing. Each request includes its target (file:line / " +
  "component / region) so you can make the change in the right place. Works " +
  "even when Live is not running (reads the on-disk requests log). Requests " +
  "with a \"screenshot\" field have a capture of the page from when they were " +
  "filed: view it with the get-live-screenshot tool. When you start or " +
  "finish one, report back with the mark-request tool.";

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
    .describe(
      "Include requests already marked done (default: only open requests, " +
        "pending and in-progress; each carries its status)"
    ),
};

type Input = { limit?: number; file?: string; includeDone?: boolean };

export type { LiveRequest, RequestTarget } from "../../live/schema.js";

interface RequestsResult {
  source: "live-socket" | "requests-file";
  requests: LiveRequest[];
  truncated: boolean;
  /** Only present when something needs the caller's attention (e.g. the
   *  on-disk log is a newer schema version than this CLI understands). */
  warnings?: string[];
  /** Present when any returned request has a stored screenshot: tells the
   *  agent how to view it. */
  screenshotHint?: string;
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
    // "in-progress" is still open work, keep it visible (with its status).
    filtered = filtered.filter((r) => r.status !== "done");
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

async function readRequestsLog(
  projectRoot: string
): Promise<{ requests: LiveRequest[]; warnings: string[] }> {
  const { items, warnings } = await readLiveLog(
    path.join(projectRoot, REQUESTS_LOG),
    "requests",
    LiveRequestSchema,
    "requests.json"
  );
  return { requests: items, warnings };
}

async function readFromLog(
  projectRoot: string,
  input: Input
): Promise<RequestsResult> {
  const { requests: all, warnings } = await readRequestsLog(projectRoot);
  const { requests, truncated } = applyFilters(all, input);
  return {
    source: "requests-file",
    requests,
    truncated,
    ...(warnings.length > 0 && { warnings }),
  };
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
        result = await readFromLog(projectRoot, input);
      } finally {
        live.close();
      }
    } else {
      result = await readFromLog(projectRoot, input);
    }

    // Requests filed in the Live desktop app carry a screenshot of the page
    // as it looked at the time, so point the agent at the tool that shows it.
    if (result.requests.some((r) => r.screenshot)) {
      result.screenshotHint =
        'Requests with a "screenshot" field include a capture of the page ' +
        "from when they were filed. Call the get-live-screenshot tool with " +
        "the request's id to view it.";
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  };
}
