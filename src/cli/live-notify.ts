/**
 * `layout-context live-notify [file]`
 *
 * The optional Claude Code hook (PRD 08) runs this after Claude edits a file.
 * It best-effort pings a running layout Live over its Unix socket so Live can
 * refresh / show a diff banner. Completely silent and a no-op when Live isn't
 * running — it must never disrupt Claude Code's hook output. Set LAYOUT_DEBUG
 * to log failures to stderr when diagnosing why notifications don't arrive.
 */
import { connectToLive } from "../mcp/tools/_live-socket.js";

function debugLog(message: string): void {
  // Stdout/stderr must stay clean for hooks by default; only speak up when
  // the user explicitly asks for diagnostics.
  if (process.env.LAYOUT_DEBUG) {
    process.stderr.write(`[layout-context live-notify] ${message}\n`);
  }
}

export async function liveNotifyCommand(file?: string): Promise<void> {
  let conn: Awaited<ReturnType<typeof connectToLive>> = null;
  try {
    conn = await connectToLive(process.cwd());
    if (!conn) {
      debugLog("Live not running (no socket) — nothing to notify");
      return; // Live not running — silent no-op
    }
    await conn.send({
      method: "notify",
      params: { event: "claude-edited", file: file ?? null },
    });
  } catch (err) {
    // Live may not implement `notify` yet, or the socket hiccuped — the
    // connection attempt is itself the useful signal; stay silent (unless
    // LAYOUT_DEBUG is set).
    debugLog(
      `notify failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    conn?.close();
  }
}
