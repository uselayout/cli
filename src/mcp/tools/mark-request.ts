/**
 * MCP tool: mark-request
 *
 * Reports progress on a layout Live AI request back to the user: flips the
 * request to "in-progress" (agent has picked it up) or "done" (change made),
 * with an optional note saying what was done. Live shows the new status on
 * the request's panel row and canvas pin, so asked-for work stops going
 * stale. Updates via Live's socket when running; falls back to editing the
 * on-disk `.layout/live/requests.json` when not.
 *
 * Compatibility note (status enum widening): old Live app versions validate
 * requests.json per item (safeParse) and skip rows whose status value they
 * do not recognise, so a request this tool marks "in-progress" is hidden in
 * those UIs until the app updates. The row is never lost: it stays in the
 * log, the new CLI still returns it from get-pending-requests, and it
 * reappears once marked "done" or the app understands the value. This is
 * inherent to widening an enum additively and accepted; when extending the
 * status set again, ship the Live app (reader) update before the CLI
 * (writer) starts emitting the new value.
 */
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { connectToLive } from "./_live-socket.js";
import type { LiveRequest } from "../../live/schema.js";

export const name = "mark-request";

export const description =
  "Marks a layout Live change request as in-progress or done so the user can " +
  "see its status in the Live desktop app (panel row + canvas pin). Call this " +
  "with the request id from get-pending-requests: status 'in-progress' when " +
  "you start a longer task, 'done' when the change is made, optionally with " +
  "a short note saying what you did. Works even when Live is not running " +
  "(updates the on-disk requests log).";

export const inputSchema = {
  id: z.string().describe("The request id (from get-pending-requests)"),
  status: z
    .enum(["in-progress", "done"])
    .describe("'in-progress' when starting the work, 'done' when it is made"),
  note: z
    .string()
    .max(500)
    .optional()
    .describe("Optional short note on what was done (shown to the user)"),
};

type Input = { id: string; status: "in-progress" | "done"; note?: string };

/** Mirrors Live's per-request history cap (protocol MAX_STATUS_HISTORY). */
const MAX_STATUS_HISTORY = 20;

const REQUESTS_LOG = path.join(".layout", "live", "requests.json");

interface MarkResult {
  source: "live-socket" | "requests-file";
  updated: boolean;
  request?: LiveRequest;
  /** Open (not-done) ids, returned when `id` was not found. */
  openIds?: string[];
}

function openIdsOf(requests: LiveRequest[]): string[] {
  return requests.filter((r) => r.status !== "done").map((r) => r.id);
}

/** Disk fallback: read → update entry → atomic write (Live's log idioms). */
async function markInLog(
  projectRoot: string,
  input: Input
): Promise<MarkResult> {
  const file = path.join(projectRoot, REQUESTS_LOG);

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { source: "requests-file", updated: false, openIds: [] };
  }

  // Live writes { version: 1, requests: [...] }; legacy files are bare arrays.
  const requests: LiveRequest[] = Array.isArray(parsed)
    ? (parsed as LiveRequest[])
    : parsed && typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).requests)
      ? ((parsed as Record<string, unknown>).requests as LiveRequest[])
      : [];

  const req = requests.find((r) => r.id === input.id);
  if (!req) {
    return { source: "requests-file", updated: false, openIds: openIdsOf(requests) };
  }

  if (req.status !== input.status || input.note !== undefined) {
    req.status = input.status;
    const history = req.history ?? [];
    history.push({
      status: input.status,
      at: new Date().toISOString(),
      actor: "agent",
      ...(input.note !== undefined && { note: input.note }),
    });
    if (history.length > MAX_STATUS_HISTORY) {
      history.splice(0, history.length - MAX_STATUS_HISTORY);
    }
    req.history = history;
  }

  // Atomic write: unique temp + rename, matching Live's own log writer.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(
    tmp,
    JSON.stringify({ version: 1, requests }, null, 2) + "\n",
    "utf8"
  );
  await fs.rename(tmp, file);

  return { source: "requests-file", updated: true, request: req };
}

function summarise(input: Input, result: MarkResult): string {
  if (result.updated) {
    const message = result.request?.message ?? "";
    const preview = message.length > 80 ? `${message.slice(0, 77)}...` : message;
    const via =
      result.source === "live-socket"
        ? "Live is showing the new status now."
        : "Recorded in .layout/live/requests.json (Live not running).";
    const noteLine = input.note ? ` Note recorded: "${input.note}".` : "";
    return `Marked request ${input.id} as ${input.status}: "${preview}". ${via}${noteLine}`;
  }
  const open = result.openIds ?? [];
  const hint =
    open.length > 0
      ? `Open request ids: ${open.join(", ")}.`
      : "There are no open requests: call get-pending-requests to check.";
  return `No request with id "${input.id}". ${hint}`;
}

export function handler() {
  return async (input: Input) => {
    const projectRoot = process.cwd();
    const live = await connectToLive(projectRoot);

    let result: MarkResult;
    if (live) {
      try {
        const res = await live.send<{
          updated: boolean;
          request?: LiveRequest;
          openIds?: string[];
        }>({
          method: "set-request-status",
          params: { id: input.id, status: input.status, note: input.note },
        });
        result = {
          source: "live-socket",
          updated: Boolean(res?.updated),
          request: res?.request,
          openIds: res?.openIds,
        };
      } catch {
        result = await markInLog(projectRoot, input);
      } finally {
        live.close();
      }
    } else {
      result = await markInLog(projectRoot, input);
    }

    return {
      content: [{ type: "text" as const, text: summarise(input, result) }],
      ...(result.updated ? {} : { isError: true as const }),
    };
  };
}
