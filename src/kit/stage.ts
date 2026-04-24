import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  LAYOUT_DIR,
  LAYOUT_MD_FILE,
  TOKENS_CSS_FILE,
  TOKENS_JSON_FILE,
  KIT_MANIFEST_FILE,
} from "./types.js";
import { getBundledKitPath } from "./loader.js";

/**
 * Resolve a user-supplied kit reference into a directory that the loader can
 * read. Accepts:
 *   1. A path to a directory containing a .layout/ subfolder (default for
 *      consumer projects).
 *   2. A path to a directory with layout.md at its root (a bundled kit or
 *      an unzipped export). Staged into a temp dir that wraps it in .layout/.
 *   3. A bundled kit name (linear-lite, stripe-lite, notion-lite). Likewise
 *      staged.
 *
 * The caller MUST invoke the returned cleanup() when done to remove any temp
 * directory the function created.
 */
export interface StagedKit {
  path: string;
  cleanup: () => void;
}

export function stageKitReference(input: string | undefined): StagedKit {
  if (!input) return { path: process.cwd(), cleanup: () => {} };
  const abs = resolve(input);
  if (existsSync(join(abs, LAYOUT_DIR))) return { path: abs, cleanup: () => {} };
  if (existsSync(join(abs, LAYOUT_MD_FILE))) return stageDirAsKit(abs);

  const bundled = getBundledKitPath(input);
  if (bundled) return stageDirAsKit(bundled);

  return { path: abs, cleanup: () => {} };
}

function stageDirAsKit(kitDir: string): StagedKit {
  const tmp = mkdtempSync(join(tmpdir(), "layout-stage-"));
  const layoutDir = join(tmp, LAYOUT_DIR);
  mkdirSync(layoutDir, { recursive: true });
  for (const f of [LAYOUT_MD_FILE, TOKENS_CSS_FILE, TOKENS_JSON_FILE, KIT_MANIFEST_FILE]) {
    const src = join(kitDir, f);
    if (existsSync(src)) writeFileSync(join(layoutDir, f), readFileSync(src));
  }
  return { path: tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}
