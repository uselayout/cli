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
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { swcTaggingReady } from "../plugins/next/index.js";

const LAYOUT_PKG = "@layoutdesign/context";

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
- \`get-pending-requests\` — free-text changes the user flagged on elements/regions in Live (use when they say "apply my requests" or "do the things I flagged")
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

// Everything under .layout/live/ is per-machine runtime state (dev-info.json
// with absolute paths/pid/port, locks, conflicts, edit + request logs, baseline
// snapshots, handoff notes) EXCEPT config.json, which is shareable team config.
// Use an allowlist so any new runtime file is ignored by default rather than a
// denylist that rots (dev-info.json + handoff.md were both missed previously).
const LIVE_GITIGNORE = "*\n!.gitignore\n!config.json\n";

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

/** The project's package manager, inferred from its lockfile. */
export function detectPackageManager(
  projectRoot: string
): "pnpm" | "yarn" | "bun" | "npm" {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(projectRoot, "bun.lockb"))) return "bun";
  return "npm";
}

/** True if @layoutdesign/context is a declared dep or already in node_modules. */
export function hasLayoutDependency(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if ({ ...pkg.dependencies, ...pkg.devDependencies }[LAYOUT_PKG]) return true;
  } catch {
    /* fall through to the node_modules check */
  }
  return fs.existsSync(
    path.join(projectRoot, "node_modules", "@layoutdesign", "context", "package.json")
  );
}

/**
 * Ensure @layoutdesign/context is installed in the user's project. A wired
 * `next.config` imports `@layoutdesign/context/next-plugin`, so without the
 * dependency `next dev` throws on config load — wiring the plugin without this
 * leaves the project WORSE than before. Idempotent; best-effort (prints the
 * manual command if the install fails).
 */
export function ensureDependency(projectRoot: string): Changes {
  if (hasLayoutDependency(projectRoot)) {
    console.log(chalk.dim("  ↳"), `${LAYOUT_PKG} already installed`);
    return { changed: false };
  }
  const pm = detectPackageManager(projectRoot);
  const args =
    pm === "npm"
      ? ["install", "--save-dev", LAYOUT_PKG]
      : pm === "yarn"
        ? ["add", "--dev", LAYOUT_PKG]
        : ["add", "-D", LAYOUT_PKG]; // pnpm + bun
  console.log(chalk.dim(`  ↳ Installing ${LAYOUT_PKG} with ${pm}…`));
  try {
    execFileSync(pm, args, { cwd: projectRoot, stdio: "ignore" });
    console.log(chalk.green("  ✓"), `${LAYOUT_PKG} installed`);
    return { changed: true };
  } catch {
    console.log(
      chalk.yellow("  ⚠"),
      `Couldn't install ${LAYOUT_PKG} automatically. Run it yourself:`
    );
    console.log(chalk.cyan(`    ${pm} ${args.join(" ")}`));
    return { changed: false };
  }
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

  // Always overwrite the tool-managed .gitignore so existing installs with a
  // stale/partial ignore list self-heal on the next run. config.json above is
  // only written when absent, so user edits to it survive.
  const gitignoreFile = path.join(liveDir, ".gitignore");
  const existingGitignore = fs.existsSync(gitignoreFile)
    ? fs.readFileSync(gitignoreFile, "utf8")
    : null;
  if (existingGitignore !== LIVE_GITIGNORE) {
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
    // Install the dependency BEFORE wiring the config that imports it, else
    // `next dev` throws on a config that references a missing module.
    ensureDependency(projectRoot);
    installPlugin(projectRoot, framework);
    // The Babel (webpack) tagging path is bypassed by Turbopack, so strip
    // `--turbopack` from `dev` — UNLESS native SWC tagging is active for this
    // project, which runs inside Next's pipeline under Turbopack too. In that
    // case Turbopack is fully supported and we leave the dev script alone.
    if (framework === "next") {
      if (swcTaggingReady(projectRoot)) {
        console.log(
          chalk.green("  ✓"),
          `Native SWC tagging enabled ${chalk.dim("(App Router + Turbopack supported)")}`
        );
      } else {
        const fix = fixTurbopackDevScript(projectRoot);
        if (fix.changed) {
          console.log(
            chalk.green("  ✓"),
            `package.json: dev → "${fix.after}" ${chalk.dim("(Turbopack bypasses source tagging)")}`
          );
        }
      }
    }
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
