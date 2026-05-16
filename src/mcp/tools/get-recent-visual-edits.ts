/**
 * MCP tool: get-recent-visual-edits
 *
 * Returns recent class/token/inline-style edits made by the user in layout
 * Live. Reads from Live's socket when running; falls back to the on-disk
 * `.layout/live/recent-edits.json` log when Live is not running.
 */
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { connectToLive } from "./_live-socket.js";

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

export interface VisualEdit {
  id: string;
  timestamp: string;
  file: string;
  line: number;
  col: number;
  component?: string;
  property: string;
  kind: "class" | "token" | "inline-style";
  before: string;
  after: string;
}

interface EditsResult {
  source: "live-socket" | "edit-log-file";
  edits: VisualEdit[];
  truncated: boolean;
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

async function readEditLog(projectRoot: string): Promise<VisualEdit[]> {
  try {
    const raw = await fs.readFile(path.join(projectRoot, EDIT_LOG), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as VisualEdit[];
    if (parsed && Array.isArray(parsed.edits)) {
      return parsed.edits as VisualEdit[];
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
        const all = await readEditLog(projectRoot);
        const { edits, truncated } = applyFilters(all, input);
        result = { source: "edit-log-file", edits, truncated };
      } finally {
        live.close();
      }
    } else {
      const all = await readEditLog(projectRoot);
      const { edits, truncated } = applyFilters(all, input);
      result = { source: "edit-log-file", edits, truncated };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  };
}
