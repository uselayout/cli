/**
 * `layout-context live-notify [file]`
 *
 * The optional Claude Code hook (PRD 08) runs this after Claude edits a file.
 * It best-effort pings a running layout Live over its Unix socket so Live can
 * refresh / show a diff banner. Completely silent and a no-op when Live isn't
 * running — it must never disrupt Claude Code's hook output.
 */
import { connectToLive } from "../mcp/tools/_live-socket.js";

export async function liveNotifyCommand(file?: string): Promise<void> {
  let conn: Awaited<ReturnType<typeof connectToLive>> = null;
  try {
    conn = await connectToLive(process.cwd());
    if (!conn) return; // Live not running — silent no-op
    await conn.send({
      method: "notify",
      params: { event: "claude-edited", file: file ?? null },
    });
  } catch {
    // Live may not implement `notify` yet, or the socket hiccuped — the
    // connection attempt is itself the useful signal; stay silent.
  } finally {
    conn?.close();
  }
}
