/**
 * MCP tool: get-selected-element
 *
 * Returns the element currently selected in the layout Live desktop app.
 * Falls back cleanly to `{ running: false }` when Live is not running.
 */
import { connectToLive } from "./_live-socket.js";

export const name = "get-selected-element";

export const description =
  "Returns the element currently selected in layout Live (desktop app). " +
  "Use this when the user says 'this', 'that one', or refers to something " +
  "they have selected visually. Returns { running: false } if Live is not running.";

// No inputs — mirrors the existing raw-shape convention (e.g. get-design-system).
export const inputSchema = {};

interface SelectionResult {
  selected: boolean;
  file?: string;
  line?: number;
  col?: number;
  component?: string;
  classList?: string;
  innerText?: string;
}

export function handler() {
  return async () => {
    const live = await connectToLive();
    if (!live) {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ running: false }) },
        ],
      };
    }

    try {
      const sel = await live.send<SelectionResult>({ method: "get-selection" });
      const payload = sel?.selected
        ? { running: true, ...sel }
        : { running: true, selected: false };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    } catch {
      // Socket present but query failed — surface as not running rather than error.
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ running: false }) },
        ],
      };
    } finally {
      live.close();
    }
  };
}
