/**
 * MCP tool: get-recent-visual-edits
 *
 * Returns recent visual edits (class/token/inline-style/text plus media
 * edits: attribute/element-swap/import/asset, and element reorders: move)
 * made by the user in layout Live. Reads from Live's socket when running; falls back to the on-disk
 * `.layout/live/recent-edits.json` log when Live is not running. Shapes per
 * the canonical contract in `src/live/schema.ts`.
 */
import { z } from "zod";
import path from "node:path";
import { connectToLive } from "./_live-socket.js";
import { readLiveLog } from "./_live-log.js";
import { VisualEditSchema, type VisualEdit } from "../../live/schema.js";

export const name = "get-recent-visual-edits";

export const description =
  "Returns recent visual edits made by the user in layout Live. Use this " +
  "when the user references 'the change I just made', 'what I tweaked', or " +
  "you need context on recent UI modifications before generating new code. " +
  "Works even when Live is not running (reads the on-disk edit log).";

export const inputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe("Maximum number of edits to return (most recent first)"),
  since: z
    .string()
    .datetime()
    .optional()
    .describe("Only return edits with an ISO-8601 timestamp at or after this"),
  file: z
    .string()
    .optional()
    .describe("Filter to edits on this file (relative to project root)"),
};

type Input = { limit?: number; since?: string; file?: string };

export type { VisualEdit } from "../../live/schema.js";

interface EditsResult {
  source: "live-socket" | "edit-log-file";
  edits: VisualEdit[];
  truncated: boolean;
  /** Only present when something needs the caller's attention (e.g. the
   *  on-disk log is a newer schema version than this CLI understands). */
  warnings?: string[];
}

const EDIT_LOG = path.join(".layout", "live", "recent-edits.json");

function applyFilters(
  edits: VisualEdit[],
  input: Input
): { edits: VisualEdit[]; truncated: boolean } {
  const limit = input.limit ?? 20;
  const sinceMs = input.since ? Date.parse(input.since) : undefined;

  let filtered = edits;
  if (input.file) {
    filtered = filtered.filter((e) => e.file === input.file);
  }
  if (sinceMs !== undefined && !Number.isNaN(sinceMs)) {
    filtered = filtered.filter((e) => Date.parse(e.timestamp) >= sinceMs);
  }
  // Most recent first.
  filtered = [...filtered].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
  );
  const truncated = filtered.length > limit;
  return { edits: filtered.slice(0, limit), truncated };
}

async function readEditLog(
  projectRoot: string
): Promise<{ edits: VisualEdit[]; warnings: string[] }> {
  const { items, warnings } = await readLiveLog(
    path.join(projectRoot, EDIT_LOG),
    "edits",
    VisualEditSchema,
    "recent-edits.json"
  );
  return { edits: items, warnings };
}

async function readFromLog(
  projectRoot: string,
  input: Input
): Promise<EditsResult> {
  const { edits: all, warnings } = await readEditLog(projectRoot);
  const { edits, truncated } = applyFilters(all, input);
  return {
    source: "edit-log-file",
    edits,
    truncated,
    ...(warnings.length > 0 && { warnings }),
  };
}

export function handler() {
  return async (input: Input) => {
    const projectRoot = process.cwd();
    const live = await connectToLive(projectRoot);

    let result: EditsResult;
    if (live) {
      try {
        const res = await live.send<{
          edits: VisualEdit[];
          truncated: boolean;
        }>({
          method: "get-edits",
          params: {
            limit: input.limit ?? 20,
            since: input.since,
            file: input.file,
          },
        });
        result = {
          source: "live-socket",
          edits: res?.edits ?? [],
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

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  };
}
