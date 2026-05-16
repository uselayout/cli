/**
 * MCP tool: lock-file
 *
 * Reserves exclusive write access to a project file so Claude and the layout
 * Live desktop app don't clobber each other's edits. Backed by the atomic
 * file-based lock store at `.layout/live/locks.json`.
 */
import { z } from "zod";
import { acquireLock } from "../live-lock-store.js";

export const name = "lock-file";

export const description =
  "Reserves exclusive write access to a file. Call this before editing a " +
  "file that may also be open in layout Live. Hold for the specified TTL, " +
  "then release with unlock-file. If the lock is held by Live, retry briefly " +
  "or notify the user.";

export const inputSchema = {
  path: z.string().describe("Path relative to project root"),
  ttl_seconds: z
    .number()
    .int()
    .positive()
    .max(300)
    .default(60)
    .describe("How long the lock is held before it auto-expires"),
  reason: z
    .string()
    .optional()
    .describe("Why the lock is being acquired"),
};

type Input = { path: string; ttl_seconds?: number; reason?: string };

export function handler() {
  return async (input: Input) => {
    const result = await acquireLock(process.cwd(), {
      path: input.path,
      ttlSeconds: input.ttl_seconds ?? 60,
      reason: input.reason,
      holder: "claude",
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  };
}
