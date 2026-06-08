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
 * ABI caveat: a `.wasm` is locked to the `swc_core` version it was built
 * against, which must be ABI-compatible with the SWC bundled in the user's
 * Next.js. A mismatch is a HARD build failure, not a graceful degrade — so this
 * path is OPT-IN (`LAYOUT_LIVE_SWC=1`) until the shipped wasm's ABI is verified
 * across the Next versions we support. Default-off preserves today's safe
 * behaviour (App Router tagging paused, app builds normally).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Node-resolvable specifier for the wasm, exposed via package.json `exports`.
 * Turbopack resolves swcPlugins entries through its module resolver and rejects
 * absolute filesystem paths, so the entry MUST be a specifier (webpack resolves
 * it too). See the App Router validation notes in swc-plugin/README.md.
 */
export const SWC_PLUGIN_SPECIFIER = "@layoutdesign/context/swc-plugin.wasm";

/**
 * Absolute path to the prebuilt tagging wasm, or null if it isn't present in
 * the installed package. Compiled location is dist/src/plugins/next/swc.js, and
 * the wasm ships at <pkg>/assets/layout-swc-plugin.wasm (package.json "files").
 */
export function resolveSwcPluginPath(): string | null {
  const candidates = [
    // Installed/built: dist/src/plugins/next/swc.js → <pkg>/assets/…
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

/**
 * Is the native SWC tagging path opted-in? Off by default (see ABI caveat
 * above). Set `LAYOUT_LIVE_SWC=1` to enable it for App Router / Turbopack.
 */
export function swcTaggingEnabled(): boolean {
  return process.env.LAYOUT_LIVE_SWC === "1";
}

/** A single `experimental.swcPlugins` entry: `[wasmPath, options]`. */
export type SwcPluginEntry = [string, Record<string, unknown>];

/**
 * The plugin entry to add to `experimental.swcPlugins`, or null when the path
 * is disabled or the wasm is missing. The first element is a node-resolvable
 * specifier (not an absolute path) so Turbopack accepts it. `projectRoot` is
 * captured so the plugin can emit project-relative `data-layout-source-file`
 * values (webpack passes absolute filenames, Turbopack project-relative ones;
 * the plugin normalises both).
 */
export function swcPluginEntry(projectRoot: string): SwcPluginEntry | null {
  if (!swcTaggingEnabled()) return null;
  // Gate on the wasm actually being present on disk, but pass the specifier.
  if (!resolveSwcPluginPath()) return null;
  return [SWC_PLUGIN_SPECIFIER, { projectRoot, dev: true }];
}
