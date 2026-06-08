/**
 * Native SWC source-tagging path for the Next.js App Router (and Turbopack).
 *
 * The Babel-via-webpack loader can't run on App Router projects: re-emitting a
 * React Server Component through Babel makes Next misclassify it as a client
 * module, breaking the build. A native SWC plugin runs inside Next's own
 * pipeline instead, so it works under both `next dev` and `next dev --turbopack`
 * without disturbing RSC.
 *
 * The plugin is a prebuilt `.wasm` (see swc-plugin/, parity-tested against
 * transform.ts). End users need no Rust toolchain.
 *
 * ABI caveat — the reason for the version guard below: a `.wasm` is locked to
 * the `swc_core` version it was built against, which MUST match the SWC bundled
 * in the user's Next.js. A mismatch is a HARD build failure
 * (`failed to invoke plugin`), not a graceful degrade. And Next bumps its
 * bundled swc_core almost every minor (15.5->35, 16.0->45, 16.1->49, 16.2->57),
 * so one prebuilt wasm only fits a narrow Next range. We therefore:
 *   1. ship a wasm built for a specific swc_core (WASM_TARGET_SWC_CORE), and
 *   2. PREDICT compatibility from the installed Next version BEFORE Next loads
 *      the plugin — injecting only on a match, so an incompatible Next gets a
 *      clean skip + warning instead of a broken build.
 * The path stays opt-in (`LAYOUT_LIVE_SWC=1`); `=force` bypasses the guard.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Node-resolvable specifier for the wasm, exposed via package.json `exports`.
 * Turbopack resolves swcPlugins entries through its module resolver and rejects
 * absolute filesystem paths, so the entry MUST be a specifier (webpack resolves
 * it too). See the App Router validation notes in swc-plugin/README.md.
 */
export const SWC_PLUGIN_SPECIFIER = "@layoutdesign/context/swc-plugin.wasm";

/**
 * The `swc_core` major the shipped wasm is built against (swc-plugin/Cargo.toml,
 * `=57.0.0`). Must equal the host Next's bundled swc_core for the plugin to
 * load. Currently corresponds to Next 16.2.x (current stable).
 */
export const WASM_TARGET_SWC_CORE = 57;

/**
 * Known Next `major.minor` -> bundled `swc_core` major, read from Next's own
 * `Cargo.lock` per release tag. Lets us predict ABI compatibility before Next
 * tries to load the plugin. Unknown (newer/older) versions -> null -> treated as
 * incompatible (skip), never a hard failure. Extend as new Next versions ship.
 */
const NEXT_SWC_CORE: Array<{ major: number; minor: number; swcCore: number }> = [
  { major: 15, minor: 3, swcCore: 21 },
  { major: 15, minor: 4, swcCore: 34 },
  { major: 15, minor: 5, swcCore: 35 },
  { major: 16, minor: 0, swcCore: 45 },
  { major: 16, minor: 1, swcCore: 49 },
  { major: 16, minor: 2, swcCore: 57 },
];

/**
 * Absolute path to the prebuilt tagging wasm, or null if it isn't present in
 * the installed package. Compiled location is dist/src/plugins/next/swc.js, and
 * the wasm ships at <pkg>/assets/layout-swc-plugin.wasm (package.json "files").
 */
export function resolveSwcPluginPath(): string | null {
  const candidates = [
    // Installed/built: dist/src/plugins/next/swc.js -> <pkg>/assets/…
    new URL("../../../../assets/layout-swc-plugin.wasm", import.meta.url),
    // Defensive fallbacks for differing dist depths.
    new URL("../../../assets/layout-swc-plugin.wasm", import.meta.url),
    new URL("../../../../../assets/layout-swc-plugin.wasm", import.meta.url),
  ];
  for (const u of candidates) {
    try {
      const p = fileURLToPath(u);
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore malformed URL on exotic loaders */
    }
  }
  return null;
}

/** Tri-state opt-in. `1` = guarded-on (inject only on ABI match); `force` =
 *  inject regardless of the version guard (explicit risk); anything else off. */
export type SwcMode = "off" | "guarded" | "force";

export function swcMode(): SwcMode {
  const v = process.env.LAYOUT_LIVE_SWC;
  if (v === "force") return "force";
  if (v === "1") return "guarded";
  return "off";
}

/** Back-compat: is the native path requested at all (guarded or forced)? */
export function swcTaggingEnabled(): boolean {
  return swcMode() !== "off";
}

/** The project's installed Next version string, or null if not resolvable. */
export function detectNextVersion(projectRoot: string): string | null {
  try {
    const pkg = path.join(projectRoot, "node_modules", "next", "package.json");
    const v = (JSON.parse(fs.readFileSync(pkg, "utf8")) as { version?: unknown })
      .version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The swc_core major bundled by the installed Next, or null if unknown. */
export function nextSwcCore(projectRoot: string): number | null {
  const v = detectNextVersion(projectRoot);
  if (!v) return null;
  const m = /^(\d+)\.(\d+)\./.exec(v);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const hit = NEXT_SWC_CORE.find((e) => e.major === major && e.minor === minor);
  return hit ? hit.swcCore : null;
}

/** Does the installed Next's bundled SWC match the shipped wasm's ABI? */
export function nextAbiMatches(projectRoot: string): boolean {
  return nextSwcCore(projectRoot) === WASM_TARGET_SWC_CORE;
}

/** A single `experimental.swcPlugins` entry: `[specifier, options]`. */
export type SwcPluginEntry = [string, Record<string, unknown>];

/**
 * Decision for whether to inject native tagging, plus a human reason for the
 * console. `entry` is null when we won't inject; `reason` explains why (shown by
 * withLayout). This keeps the (testable) policy in one place.
 */
export interface SwcDecision {
  entry: SwcPluginEntry | null;
  reason: string;
}

/**
 * Resolve the native-tagging decision for a project. Never returns an entry that
 * would hard-fail the build: in `guarded` mode it injects only when the Next ABI
 * matches the shipped wasm; in `force` mode it injects regardless (explicit
 * user risk); when off, nothing.
 */
export function resolveSwcDecision(projectRoot: string): SwcDecision {
  const mode = swcMode();
  if (mode === "off") return { entry: null, reason: "off" };

  if (!resolveSwcPluginPath()) {
    return { entry: null, reason: "wasm-missing" };
  }

  const entry: SwcPluginEntry = [
    SWC_PLUGIN_SPECIFIER,
    { projectRoot, dev: true },
  ];

  if (mode === "force") {
    return { entry, reason: "forced" };
  }

  // guarded: predict ABI from the installed Next version.
  const hostSwc = nextSwcCore(projectRoot);
  if (hostSwc === WASM_TARGET_SWC_CORE) {
    return { entry, reason: "abi-match" };
  }
  const nextV = detectNextVersion(projectRoot) ?? "unknown";
  return {
    entry: null,
    reason:
      hostSwc == null
        ? `abi-unknown:${nextV}`
        : `abi-mismatch:${nextV}:swc_core${hostSwc}`,
  };
}

/**
 * The plugin entry to add to `experimental.swcPlugins`, or null. Thin wrapper
 * over `resolveSwcDecision` for callers that only need the entry.
 */
export function swcPluginEntry(projectRoot: string): SwcPluginEntry | null {
  return resolveSwcDecision(projectRoot).entry;
}
