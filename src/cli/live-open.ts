/**
 * `layout-context live [project-path]`
 *
 * Opens Layout Live (the desktop app) already bound to THIS project and its
 * running dev server — no manual URL typing, no folder picker, correct even
 * with several localhosts running.
 *
 * Binding is deterministic: the Layout vite/next plugin writes
 * `.layout/live/dev-info.json` ({ projectRoot, url }) when the dev server
 * starts. We read it, so we know exactly which port serves this project and
 * which root the plugin stamped source paths against (the value Live needs to
 * resolve clicks → files). Falls back to `--port`, then a liveness probe.
 *
 * If a Live is already open on this project we just focus it; otherwise we
 * spawn the app with LAYOUT_LIVE_PROJECT + LAYOUT_LIVE_DEV_URL (both honoured
 * by Live's boot).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { spawn, execFileSync } from "node:child_process";
import { connectToLive } from "../mcp/tools/_live-socket.js";
import { preflightSourceTags, htmlHasSourceTags } from "./live-preflight.js";

export interface LiveOpenOptions {
  /** Override dev-server port (skip dev-info.json / probing). */
  port?: string;
  /** Explicit path to the Layout Live executable (skip auto-detect). */
  livePath?: string;
  /** Skip the source-tag preflight (open as-is). */
  setup?: boolean;
  /** Auto-accept preflight file edits without prompting. */
  yes?: boolean;
}

const PROBE_PORTS = [5173, 3000, 3001, 4321, 5174, 8080];

/** True if something answers an HTTP request at `url` within the timeout. */
async function serverResponds(url: string, timeoutMs = 1200): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Any HTTP response (even 404) means a server is listening.
    await fetch(url, { signal: ctrl.signal, redirect: "manual" });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

interface DevInfo {
  projectRoot: string;
  url: string;
}

export interface DiscoverDeps {
  responds?: (url: string) => Promise<boolean>;
  hasTags?: (url: string) => Promise<boolean>;
  prompt?: (urls: string[]) => Promise<string | null>;
  ports?: number[];
}

/**
 * Probe every conventional port, then choose THIS project's dev server instead
 * of the first random responder. Prefers servers already emitting Layout source
 * tags; if several qualify, asks the user. Returns the chosen URL or null.
 * Deps are injectable for tests.
 */
export async function discoverDevUrl(deps: DiscoverDeps = {}): Promise<string | null> {
  const responds = deps.responds ?? serverResponds;
  const hasTags = deps.hasTags ?? htmlHasSourceTags;
  const prompt = deps.prompt ?? promptDevUrl;
  const ports = deps.ports ?? PROBE_PORTS;

  const responders: string[] = [];
  for (const port of ports) {
    const url = `http://localhost:${port}`;
    if (await responds(url)) responders.push(url);
  }
  if (responders.length === 0) return null;
  if (responders.length === 1) return responders[0] ?? null;

  // Several servers up — prefer Layout-tagged ones (this project's, most
  // likely), then disambiguate by asking rather than guessing.
  const tagged: string[] = [];
  for (const url of responders) {
    if (await hasTags(url)) tagged.push(url);
  }
  const candidates = tagged.length > 0 ? tagged : responders;
  if (candidates.length === 1) return candidates[0] ?? null;
  return prompt(candidates);
}

/** Ask the user which running dev server to use. Non-TTY → first candidate. */
async function promptDevUrl(urls: string[]): Promise<string | null> {
  if (!process.stdin.isTTY) return urls[0] ?? null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    console.log("Multiple dev servers are running:");
    urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
    const ans = (await rl.question(`Which one is this project? [1-${urls.length}] `)).trim();
    const idx = Number(ans) - 1;
    return urls[idx] ?? urls[0] ?? null;
  } finally {
    rl.close();
  }
}

/** Read .layout/live/dev-info.json if present and well-formed. */
function readDevInfo(projectRoot: string): DevInfo | null {
  try {
    const raw = fs.readFileSync(
      path.join(projectRoot, ".layout", "live", "dev-info.json"),
      "utf8"
    );
    const j = JSON.parse(raw) as Partial<DevInfo>;
    if (typeof j.url === "string" && typeof j.projectRoot === "string") {
      return { url: j.url, projectRoot: j.projectRoot };
    }
  } catch {
    /* absent or malformed — fall through */
  }
  return null;
}

/** Locate the Layout Live executable for the current platform. */
function findLiveApp(override?: string): string | null {
  if (override && fs.existsSync(override)) return override;

  if (process.platform === "darwin") {
    const appDirs = ["/Applications", path.join(os.homedir(), "Applications")];
    for (const dir of appDirs) {
      const app = path.join(dir, "Layout Live.app");
      const macos = path.join(app, "Contents", "MacOS");
      try {
        const first = fs.readdirSync(macos)[0];
        if (first) return path.join(macos, first);
      } catch {
        /* not here */
      }
    }
  } else if (process.platform === "win32") {
    for (const base of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env["LOCALAPPDATA"]]) {
      if (!base) continue;
      const exe = path.join(base, "Layout Live", "Layout Live.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }

  // Linux / global installs: try PATH.
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const bin = process.platform === "win32" ? "layout-live.exe" : "layout-live";
    const found = execFileSync(which, [bin], { encoding: "utf8" }).split("\n")[0]?.trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* not on PATH */
  }
  return null;
}

export async function liveOpenCommand(
  projectPath?: string,
  options: LiveOpenOptions = {}
): Promise<void> {
  const cwd = path.resolve(projectPath ?? process.cwd());

  // 1. Resolve the project root + dev URL. dev-info.json is authoritative for
  //    BOTH (its projectRoot is the root the plugin stamped against).
  let projectRoot = cwd;
  let devUrl: string | null = null;

  const info = readDevInfo(cwd);
  if (info && (await serverResponds(info.url))) {
    projectRoot = path.resolve(info.projectRoot);
    devUrl = info.url;
  } else if (options.port) {
    const url = `http://localhost:${options.port}`;
    if (!(await serverResponds(url))) {
      console.error(`No dev server is responding at ${url}. Start it first (e.g. npm run dev).`);
      process.exitCode = 1;
      return;
    }
    devUrl = url;
  } else {
    // Fallback probe — best effort when the plugin hint is absent. Picks THIS
    // project's server (Layout-tagged) over an unrelated localhost, and asks
    // when several qualify, instead of grabbing the first open port.
    devUrl = await discoverDevUrl();
  }

  if (!devUrl) {
    console.error(
      "Couldn't find a running dev server.\n" +
        "  • Start it first (e.g. npm run dev), then re-run, or pass --port <n>.\n" +
        "  • Tip: add the Layout plugin to your dev config so this is automatic\n" +
        "    (it writes .layout/live/dev-info.json on start)."
    );
    process.exitCode = 1;
    return;
  }

  // 2. Make sure the dev server will emit source tags (else the canvas opens
  //    dead). Wires the plugin / fixes a Turbopack dev script with consent, or
  //    prints exact setup steps. We still open afterwards so the page is
  //    visible; it becomes editable once the user restarts the dev server.
  if (options.setup !== false) {
    await preflightSourceTags(projectRoot, devUrl, { yes: options.yes });
  }

  // 3. Already running on this project? Re-bind it to this dev URL (so a new
  //    --port actually takes effect) and bring it to the front.
  const existing = await connectToLive(projectRoot);
  if (existing) {
    try {
      // set-dev-url rebinds a running window; older Live lacks it → fall back
      // to focus-only so we still surface the window.
      try {
        await existing.send({ method: "set-dev-url", params: { url: devUrl } });
        console.log(`✓ Re-bound Layout Live to ${devUrl}.`);
      } catch {
        /* older Live: no set-dev-url — focus is the best we can do */
      }
      await existing.send({ method: "focus" });
      console.log(`✓ Layout Live is already open for this project — brought to front.\n  dev: ${devUrl}`);
      return;
    } catch {
      // Live is older and doesn't implement `focus` — fall through to spawn a
      // fresh window pointed at the same project.
    } finally {
      existing.close();
    }
  }

  // 4. Launch the app, bound to project + dev server via env.
  const bin = findLiveApp(options.livePath);
  if (!bin) {
    console.error(
      "Couldn't find the Layout Live app.\n" +
        "  • Install it, or pass --live-path <path-to-executable>.\n" +
        (process.platform === "darwin"
          ? "  • Expected at /Applications/Layout Live.app."
          : "  • Expected `layout-live` on your PATH.")
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(bin, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      LAYOUT_LIVE_PROJECT: projectRoot,
      LAYOUT_LIVE_DEV_URL: devUrl,
    },
  });
  child.unref();

  console.log(
    `✓ Layout Live opened\n  project: ${projectRoot}\n  dev:     ${devUrl}\n  (click an element to edit — changes write back to source)`
  );
}
