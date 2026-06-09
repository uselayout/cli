/**
 * Native SWC source-tagging path for the Next.js App Router (and Turbopack).
 *
 * The Babel-via-webpack loader can't run on App Router projects: re-emitting a
 * React Server Component through Babel makes Next misclassify it as a client
 * module, breaking the build. A native SWC plugin runs inside Next's own
 * pipeline instead, so it works under both `next dev` and `next dev --turbopack`
 * without disturbing RSC.
 *
 * Multi-ABI: a wasm SWC plugin is locked to the `swc_core` version it was built
 * against, which MUST match the SWC bundled in the user's Next.js. Next bumps
 * that almost every minor (15.5->35, 16.0->45, 16.1->49, 16.2->57). We ship one
 * prebuilt wasm per SUPPORTED swc_core ABI and pick the matching one at config
 * time from the installed Next version. A Next we don't have a wasm for is
 * skipped (clean message), never a hard build failure.
 *
 * Default is guarded-ON: once the plugin is wired, tagging auto-enables on a
 * supported Next. `LAYOUT_LIVE_SWC=0` turns it off; `=force` bypasses the guard.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** File name of the committed wasms: assets/<file>-<swcCore>.wasm. */
const WASM_FILE_BASENAME = "layout-swc-plugin";
/** Export subpath base (package.json "exports"): @layoutdesign/context/<sub>-<n>.wasm */
const SPECIFIER_BASENAME = "swc-plugin";

/**
 * The `swc_core` ABIs we ship a prebuilt wasm for. Each corresponds to a Next
 * range (35 = Next 15.5.x, 57 = Next 16.2.x). Extend by adding a wasm via
 * swc-plugin/build.sh and listing the ABI here.
 */
export const SHIPPED_SWC_CORES: readonly number[] = [35, 57];

/**
 * Known Next `major.minor` -> bundled `swc_core` major, read from Next's own
 * `Cargo.lock` per release tag. Lets us pick the right wasm (and skip Next
 * versions we don't ship an ABI for) BEFORE Next tries to load the plugin.
 */
const NEXT_SWC_CORE: Array<{ major: number; minor: number; swcCore: number }> = [
  { major: 15, minor: 3, swcCore: 21 },
  { major: 15, minor: 4, swcCore: 34 },
  { major: 15, minor: 5, swcCore: 35 },
  { major: 16, minor: 0, swcCore: 45 },
  { major: 16, minor: 1, swcCore: 49 },
  { major: 16, minor: 2, swcCore: 57 },
];

/** Node-resolvable specifier for the wasm of a given swc_core ABI. Turbopack
 *  resolves swcPlugins via its module resolver and rejects absolute paths, so
 *  the entry MUST be a specifier (webpack resolves it too). */
export function swcPluginSpecifier(swcCore: number): string {
  return `@layoutdesign/context/${SPECIFIER_BASENAME}-${swcCore}.wasm`;
}

/** Absolute path to the shipped wasm for swc_core `swcCore`, or null if absent.
 *  Compiled location is dist/src/plugins/next/swc.js; wasms ship at
 *  <pkg>/assets/<basename>-<swcCore>.wasm (package.json "files"). */
export function resolveSwcPluginPath(swcCore: number): string | null {
  const file = `${WASM_FILE_BASENAME}-${swcCore}.wasm`;
  const candidates = [
    new URL(`../../../../assets/${file}`, import.meta.url),
    new URL(`../../../assets/${file}`, import.meta.url),
    new URL(`../../../../../assets/${file}`, import.meta.url),
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

/** Tri-state. Default `guarded` (auto-on for supported Next); `off` disables;
 *  `force` injects regardless of the version guard (explicit risk). */
export type SwcMode = "off" | "guarded" | "force";

export function swcMode(): SwcMode {
  const v = process.env.LAYOUT_LIVE_SWC;
  if (v === "0" || v === "off" || v === "false") return "off";
  if (v === "force") return "force";
  return "guarded"; // default-on; `1` also lands here (back-compat)
}

/** Back-compat: is the native path enabled at all (guarded or forced)? */
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

/** Do we ship a wasm whose ABI matches the installed Next? */
export function nextAbiSupported(projectRoot: string): boolean {
  const n = nextSwcCore(projectRoot);
  return n != null && SHIPPED_SWC_CORES.includes(n);
}

/** A single `experimental.swcPlugins` entry: `[specifier, options]`. */
export type SwcPluginEntry = [string, Record<string, unknown>];

/**
 * Decision for whether to inject native tagging, plus a human reason. `entry`
 * is null when we won't inject. Never returns an entry that would hard-fail the
 * build: guarded mode injects only when we have a wasm for the host Next's ABI;
 * force injects the newest shipped ABI regardless (explicit user risk).
 */
export interface SwcDecision {
  entry: SwcPluginEntry | null;
  reason: string;
}

export function resolveSwcDecision(projectRoot: string): SwcDecision {
  const mode = swcMode();
  if (mode === "off") return { entry: null, reason: "off" };

  const hostSwc = nextSwcCore(projectRoot);
  const make = (swcCore: number, reason: string): SwcDecision | null =>
    resolveSwcPluginPath(swcCore)
      ? {
          entry: [swcPluginSpecifier(swcCore), { projectRoot, dev: true }],
          reason,
        }
      : null;

  // Preferred: an exact ABI match for the installed Next.
  if (hostSwc != null && SHIPPED_SWC_CORES.includes(hostSwc)) {
    const d = make(hostSwc, `abi-match:${hostSwc}`);
    if (d) return d;
  }

  if (mode === "force") {
    // No matching wasm — gamble on the newest shipped ABI (user opted in).
    const newest = Math.max(...SHIPPED_SWC_CORES);
    const d = make(newest, `forced:${newest}`);
    if (d) return d;
    return { entry: null, reason: "wasm-missing" };
  }

  // guarded + unsupported/unknown → skip safely.
  const nextV = detectNextVersion(projectRoot) ?? "unknown";
  return {
    entry: null,
    reason:
      hostSwc == null
        ? `abi-unknown:${nextV}`
        : `abi-unsupported:${nextV}:swc_core${hostSwc}`,
  };
}

/** The plugin entry to add to `experimental.swcPlugins`, or null. */
export function swcPluginEntry(projectRoot: string): SwcPluginEntry | null {
  return resolveSwcDecision(projectRoot).entry;
}
