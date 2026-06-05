/**
 * `npx @layoutdesign/context install --live`
 *
 * Wires a project up for layout Live:
 *   1. Detect framework (vite | next) from package.json
 *   2. Add the matching build plugin to vite.config / next.config (recast —
 *      formatting + comments preserved; original backed up first)
 *   3. Create .layout/live/ with config.json + a local .gitignore
 *   4. Append the layout-live managed block to CLAUDE.md
 *
 * Every step is idempotent: re-running --live when everything is already set
 * up makes no changes and reports "already configured".
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import chalk from "chalk";

const require = createRequire(import.meta.url);
// recast + its TS/JSX parser are CJS — load via createRequire under ESM.
const recast = require("recast") as typeof import("recast");
const babelTsParser = require("recast/parsers/babel-ts");

export type Framework = "vite" | "next" | "unknown";

const VITE_IMPORT = `import layout from "@layoutdesign/context/vite-plugin";`;
const NEXT_IMPORT = `import withLayout from "@layoutdesign/context/next-plugin";`;
const CLAUDE_BEGIN = "<!-- BEGIN layout-live (managed) -->";
const CLAUDE_END = "<!-- END layout-live (managed) -->";

const CLAUDE_BLOCK = `${CLAUDE_BEGIN}
## Recent visual edits (layout Live)

The user has layout Live installed (desktop app). They may make visual edits — colour, spacing, typography tweaks — directly in their running app. These edits land in source files instantly.

To open it (or tell the user to), run \`npx @layoutdesign/context live\` from the project root with the dev server running — it auto-binds Live to this project's dev server, no manual URL.

When relevant, use these MCP tools:
- \`get-recent-visual-edits\` — recent class/token changes
- \`get-selected-element\` — element currently selected in Live (use when the user says "this" or "that one")
- \`lock-file\` / \`unlock-file\` — coordinate file access before editing

If you are about to edit a file the user is also editing visually:
1. Call \`lock-file\` with the file path and a short TTL (default 60s).
2. If the lock is held by Live, wait briefly and retry, or surface to the user.
3. Make your edit, then call \`unlock-file\`.

The user holds priority on visual edits. Don't undo visual tweaks unless they explicitly ask.
${CLAUDE_END}`;

const LIVE_CONFIG = {
  $schema: "https://layout.design/schema/live-config/v1.json",
  version: 1,
  snapToScale: true,
  complianceScoring: {
    enabled: true,
    debounceMs: 2000,
    minEditsBetweenChecks: 5,
  },
  exclude: [] as string[],
};

const LIVE_GITIGNORE = "recent-edits.*\nlocks.json\nconflicts.json\n";

interface Changes {
  changed: boolean;
}

/** Read package.json deps to decide which build plugin applies. */
export function detectFramework(projectRoot: string): Framework {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return "unknown";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["next"]) return "next";
    if (deps["vite"]) return "vite";
  } catch {
    /* fall through */
  }
  return "unknown";
}

function findConfig(projectRoot: string, base: string): string | null {
  for (const ext of ["ts", "mts", "js", "mjs"]) {
    const p = path.join(projectRoot, `${base}.config.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** True if the layout build plugin is already wired into the config file. */
export function isPluginWired(
  projectRoot: string,
  framework: Framework
): boolean {
  if (framework === "unknown") return false;
  const base = framework === "next" ? "next" : "vite";
  const configPath = findConfig(projectRoot, base);
  if (!configPath) return false;
  try {
    const src = fs.readFileSync(configPath, "utf8");
    const specifier =
      framework === "next"
        ? "@layoutdesign/context/next-plugin"
        : "@layoutdesign/context/vite-plugin";
    return src.includes(specifier);
  } catch {
    return false;
  }
}

export interface TurbopackFix {
  changed: boolean;
  /** The `dev` script name that was (or would be) changed. */
  script?: string;
  before?: string;
  after?: string;
}

/**
 * Drop `--turbopack` / `--turbo` from the project's `dev` script. Next's
 * webpack-based source-tagging plugin is bypassed under Turbopack, so the
 * visual-edit loop needs plain `next dev`. Idempotent; only touches a `dev`
 * script that actually runs Next with the turbo flag.
 */
export function fixTurbopackDevScript(projectRoot: string): TurbopackFix {
  const pkgPath = path.join(projectRoot, "package.json");
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, "utf8");
  } catch {
    return { changed: false };
  }
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return { changed: false };
  }
  const dev = pkg.scripts?.dev;
  if (!dev || !/\bnext\b/.test(dev) || !/--turbopack\b|--turbo\b/.test(dev)) {
    return { changed: false };
  }
  const after = dev
    .replace(/\s*--turbopack\b/g, "")
    .replace(/\s*--turbo\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  pkg.scripts!.dev = after;
  // Re-serialise preserving the original indentation where detectable.
  const indent = raw.match(/\n(\s+)"/)?.[1] ?? "  ";
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
  return { changed: true, script: "dev", before: dev, after };
}

function backup(configPath: string): void {
  const backupPath = `${configPath}.layout-backup`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(configPath, backupPath);
  }
}

function parse(src: string) {
  return recast.parse(src, { parser: babelTsParser });
}

/** Insert an import line at the top if its specifier isn't already present. */
function ensureImport(src: string, importLine: string, specifier: string): string {
  if (src.includes(specifier)) return src;
  return `${importLine}\n${src}`;
}

/**
 * Add `layout()` as the first entry of the Vite `plugins` array. Returns the
 * new source, or null if the config shape is too unusual to edit safely.
 */
function patchViteConfig(src: string): string | null {
  if (src.includes("@layoutdesign/context/vite-plugin")) return src; // idempotent
  let ast;
  try {
    ast = parse(src);
  } catch {
    return null;
  }

  let patched = false;
  // babel-ts produces ObjectProperty nodes (not ESTree Property).
  recast.types.visit(ast, {
    visitObjectProperty(p: any) {
      const key = p.node.key;
      const keyName = key?.name ?? key?.value;
      if (keyName === "plugins" && p.node.value?.type === "ArrayExpression") {
        const callExpr = recast.types.builders.callExpression(
          recast.types.builders.identifier("layout"),
          []
        );
        p.node.value.elements.unshift(callExpr);
        patched = true;
        return false;
      }
      this.traverse(p);
    },
  });

  if (!patched) return null;
  const printed = recast.print(ast).code;
  return ensureImport(printed, VITE_IMPORT, "@layoutdesign/context/vite-plugin");
}

/**
 * Wrap the default export with `withLayout(...)`. Handles
 * `export default <expr>` (incl. an identifier referencing the config object).
 */
function patchNextConfig(src: string): string | null {
  if (src.includes("@layoutdesign/context/next-plugin")) return src; // idempotent
  let ast;
  try {
    ast = parse(src);
  } catch {
    return null;
  }

  const b = recast.types.builders;
  let patched = false;

  recast.types.visit(ast, {
    visitExportDefaultDeclaration(p: any) {
      const decl = p.node.declaration;
      if (decl) {
        p.node.declaration = b.callExpression(b.identifier("withLayout"), [
          decl,
        ]);
        patched = true;
      }
      return false;
    },
    visitAssignmentExpression(p: any) {
      // CommonJS: module.exports = <expr>
      const left = p.node.left;
      if (
        left?.type === "MemberExpression" &&
        left.object?.name === "module" &&
        left.property?.name === "exports"
      ) {
        p.node.right = b.callExpression(b.identifier("withLayout"), [
          p.node.right,
        ]);
        patched = true;
        return false;
      }
      this.traverse(p);
    },
  });

  if (!patched) return null;
  const printed = recast.print(ast).code;
  const importLine = src.includes("module.exports")
    ? `const withLayout = require("@layoutdesign/context/next-plugin").default;`
    : NEXT_IMPORT;
  return ensureImport(printed, importLine, "@layoutdesign/context/next-plugin");
}

export function installPlugin(projectRoot: string, framework: Framework): Changes {
  const base = framework === "next" ? "next" : "vite";
  const configPath = findConfig(projectRoot, base);

  if (!configPath) {
    console.log(
      chalk.yellow("  ⚠"),
      `No ${base}.config.* found. Add the plugin manually:`
    );
    console.log(
      chalk.dim(
        framework === "next"
          ? `    ${NEXT_IMPORT}\n    export default withLayout({ /* ...config */ });`
          : `    ${VITE_IMPORT}\n    plugins: [layout(), react()]`
      )
    );
    return { changed: false };
  }

  const original = fs.readFileSync(configPath, "utf8");
  const patched =
    framework === "next"
      ? patchNextConfig(original)
      : patchViteConfig(original);

  if (patched === null) {
    console.log(
      chalk.yellow("  ⚠"),
      `${path.basename(configPath)} has an unusual shape — not modified. Add manually:`
    );
    console.log(
      chalk.dim(
        framework === "next"
          ? `    Wrap your config export with withLayout() from @layoutdesign/context/next-plugin`
          : `    Add layout() (before react()) to plugins, import from @layoutdesign/context/vite-plugin`
      )
    );
    return { changed: false };
  }

  if (patched === original) {
    console.log(
      chalk.dim("  ↳"),
      `${path.basename(configPath)}: plugin already configured`
    );
    return { changed: false };
  }

  backup(configPath);
  fs.writeFileSync(configPath, patched);
  console.log(
    chalk.green("  ✓"),
    `${path.basename(configPath)}: added layout build plugin ${chalk.dim(
      "(backup: " + path.basename(configPath) + ".layout-backup)"
    )}`
  );
  return { changed: true };
}

export function ensureLayoutLiveDir(projectRoot: string): Changes {
  const liveDir = path.join(projectRoot, ".layout", "live");
  let changed = false;

  fs.mkdirSync(liveDir, { recursive: true });

  const configFile = path.join(liveDir, "config.json");
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, JSON.stringify(LIVE_CONFIG, null, 2) + "\n");
    changed = true;
  }

  const gitignoreFile = path.join(liveDir, ".gitignore");
  if (!fs.existsSync(gitignoreFile)) {
    fs.writeFileSync(gitignoreFile, LIVE_GITIGNORE);
    changed = true;
  }

  console.log(
    changed ? chalk.green("  ✓") : chalk.dim("  ↳"),
    changed
      ? ".layout/live/ created (config.json + .gitignore)"
      : ".layout/live/ already present"
  );
  return { changed };
}

/**
 * Apply the delimited managed block to one agent file, idempotently.
 * `createIfMissing` distinguishes CLAUDE.md (always created) from
 * AGENTS.md / .cursorrules (only augmented if the project already has them).
 */
function applyManagedBlock(
  file: string,
  label: string,
  createIfMissing: boolean
): Changes {
  const exists = fs.existsSync(file);
  if (!exists && !createIfMissing) return { changed: false };
  const existing = exists ? fs.readFileSync(file, "utf8") : "";

  if (existing.includes(CLAUDE_BEGIN)) {
    const before = existing.slice(0, existing.indexOf(CLAUDE_BEGIN));
    const afterIdx = existing.indexOf(CLAUDE_END);
    const after =
      afterIdx === -1 ? "" : existing.slice(afterIdx + CLAUDE_END.length);
    const next = `${before}${CLAUDE_BLOCK}${after}`;
    if (next === existing) {
      console.log(chalk.dim("  ↳"), `${label}: managed block already current`);
      return { changed: false };
    }
    fs.writeFileSync(file, next);
    console.log(chalk.green("  ✓"), `${label}: refreshed layout-live block`);
    return { changed: true };
  }

  const sep =
    existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, `${existing}${sep}${CLAUDE_BLOCK}\n`);
  console.log(
    chalk.green("  ✓"),
    existing.length === 0
      ? `${label}: created with layout-live block`
      : `${label}: appended layout-live block`
  );
  return { changed: true };
}

function appendClaudeMdSection(projectRoot: string): Changes {
  // CLAUDE.md is created if absent; AGENTS.md / .cursorrules are only
  // augmented when the project already exports them.
  const claude = applyManagedBlock(
    path.join(projectRoot, "CLAUDE.md"),
    "CLAUDE.md",
    true
  );
  const agents = applyManagedBlock(
    path.join(projectRoot, "AGENTS.md"),
    "AGENTS.md",
    false
  );
  const cursor = applyManagedBlock(
    path.join(projectRoot, ".cursorrules"),
    ".cursorrules",
    false
  );
  return {
    changed: claude.changed || agents.changed || cursor.changed,
  };
}

export async function installLive(projectRoot: string): Promise<void> {
  console.log();
  console.log(chalk.bold("  layout Live"));

  const framework = detectFramework(projectRoot);
  if (framework === "unknown") {
    console.log(
      chalk.yellow("  ⚠"),
      "Could not detect Vite or Next.js in package.json — skipping plugin step."
    );
  } else {
    console.log(chalk.dim(`  ↳ Framework detected: ${framework}`));
    installPlugin(projectRoot, framework);
  }

  ensureLayoutLiveDir(projectRoot);
  appendClaudeMdSection(projectRoot);

  console.log();
  console.log(
    chalk.dim("  layout Live tools are exposed by the MCP server automatically.")
  );
  console.log(
    chalk.dim("  Open it any time with your dev server running:"),
    chalk.cyan("npx @layoutdesign/context live")
  );
}
