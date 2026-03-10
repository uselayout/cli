import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Kit, KitManifest, KitComponent } from "./types.js";
import {
  SUPERDUPER_DIR,
  KIT_MANIFEST_FILE,
  DESIGN_MD_FILE,
  TOKENS_CSS_FILE,
  TOKENS_JSON_FILE,
  TAILWIND_CONFIG_FILE,
  COMPONENTS_DIR,
} from "./types.js";
import { parseDesignMd, parseComponents } from "./parser.js";

/**
 * Load a kit from a .superduper/ directory.
 * Looks in the current working directory by default.
 */
export function loadKit(basePath?: string): Kit | null {
  const dir = resolve(basePath ?? process.cwd(), SUPERDUPER_DIR);

  if (!existsSync(dir)) return null;

  const manifestPath = join(dir, KIT_MANIFEST_FILE);
  const designMdPath = join(dir, DESIGN_MD_FILE);

  if (!existsSync(designMdPath)) return null;

  const manifest: KitManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf-8"))
    : {
        name: "custom",
        version: "1.0.0",
        displayName: "Custom",
        description: "User-provided design system",
        source: "custom",
        tier: "free" as const,
        tokenCount: 0,
        componentCount: 0,
        aesthetic: "",
      };

  const designMd = readFileSync(designMdPath, "utf-8");
  const sections = parseDesignMd(designMd);

  let components = parseComponents(designMd);

  // Also load individual component files if present
  const componentsDir = join(dir, COMPONENTS_DIR);
  if (existsSync(componentsDir)) {
    const files = readdirSync(componentsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = readFileSync(join(componentsDir, file), "utf-8");
      const parsed = parseComponents(`## Components\n### ${content}`);
      components = [...components, ...parsed];
    }
  }

  const tokensCss = readSafe(join(dir, TOKENS_CSS_FILE));
  const tokensJson = readSafe(join(dir, TOKENS_JSON_FILE));
  const tailwindConfig = readSafe(join(dir, TAILWIND_CONFIG_FILE));

  return {
    manifest,
    designMd,
    sections,
    components,
    tokensCss: tokensCss ?? undefined,
    tokensJson: tokensJson ?? undefined,
    tailwindConfig: tailwindConfig ?? undefined,
  };
}

/**
 * Find the path to a bundled kit by name.
 */
export function getBundledKitPath(kitName: string): string | null {
  // Resolve relative to this file's location in the package
  // At runtime this file is at dist/src/kit/loader.js, kits/ is at package root
  const kitsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "kits"
  );

  const kitDir = join(kitsDir, kitName);
  return existsSync(kitDir) ? kitDir : null;
}

/**
 * List all bundled kits.
 */
export function listBundledKits(): string[] {
  const kitsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "kits"
  );

  if (!existsSync(kitsDir)) return [];

  return readdirSync(kitsDir).filter((entry) => {
    const kitJson = join(kitsDir, entry, KIT_MANIFEST_FILE);
    return existsSync(kitJson);
  });
}

function readSafe(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
  } catch {
    return null;
  }
}
