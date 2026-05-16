/**
 * MCP tool: unlock-file
 *
 * Releases a previously-acquired file lock by its lock id. Only the entry
 * whose `lock_id` matches is removed.
 */
import { z } from "zod";
import { releaseLock } from "../live-lock-store.js";

export const name = "unlock-file";

export const description =
  "Releases a previously-acquired file lock. Pass the lock_id returned by " +
  "lock-file. A non-matching or already-expired lock_id releases nothing.";

export const inputSchema = {
  lock_id: z.string().describe("The lock_id returned by a prior lock-file call"),
};

type Input = { lock_id: string };

export function handler() {
  return async (input: Input) => {
    const result = await releaseLock(process.cwd(), input.lock_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  };
}
