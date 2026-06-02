/**
 * MCP tool: open-live
 *
 * Brings the layout Live desktop app to the foreground so the user can see and
 * visually edit the UI the agent just generated/changed. Three outcomes, never
 * throws:
 *   - Live already running on this project → focuses its window.
 *   - Live installed but not running       → launches the app (Phase A: the
 *     user picks the project; deep-link project hand-off is Phase B).
 *   - Live not installed                   → returns how to start it.
 */
import { execFileSync } from "node:child_process";
import { connectToLive } from "./_live-socket.js";
import { isLiveInstalled } from "./check-setup.js";

export const name = "open-live";

export const description =
  "Opens or focuses the layout Live desktop app for this project so the user " +
  "can see and visually edit the UI. Call this after generating or changing a " +
  "component when the user wants to view or tweak it live. Focuses Live if it's " +
  "already running, launches it if installed, otherwise returns how to start it. " +
  "Never fails.";

// No inputs — mirrors the other Live tools' raw-shape convention.
export const inputSchema = {};

const LAUNCH_INSTRUCTIONS =
  "layout Live isn't running. Start it, then ask again:\n" +
  "  1) in your project dir:  npm run dev\n" +
  "  2) in the layout-live app:  open it (or, from source, LAYOUT_LIVE_PROJECT=<project-path> npm run dev:electron)";

/** Best-effort launch of the installed app. Returns false if it couldn't. */
function launchInstalledApp(): boolean {
  try {
    if (process.platform === "darwin") {
      // `open -a` hands off to LaunchServices and returns immediately.
      execFileSync("open", ["-a", "Layout Live"], { stdio: "ignore" });
      return true;
    }
    // Windows / Linux: rely on a `layout-live` launcher on PATH.
    execFileSync("layout-live", [], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

interface OpenResult {
  running: boolean;
  focused?: boolean;
  launched?: boolean;
  note?: string;
  instructions?: string;
}

export async function computeOpen(): Promise<OpenResult> {
  const live = await connectToLive();
  if (live) {
    try {
      const res = await live.send<{ focused?: boolean }>({ method: "focus" });
      return { running: true, focused: Boolean(res?.focused) };
    } catch {
      // Socket present but the focus request failed — still "running".
      return { running: true, focused: false };
    } finally {
      live.close();
    }
  }

  if (isLiveInstalled() && launchInstalledApp()) {
    return {
      running: false,
      launched: true,
      note: "Opened layout Live. Select this project in its welcome screen — automatic project hand-off is coming soon.",
    };
  }

  return { running: false, launched: false, instructions: LAUNCH_INSTRUCTIONS };
}

export function handler() {
  return async () => {
    const result = await computeOpen();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  };
}
