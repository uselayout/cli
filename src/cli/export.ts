/**
 * `npx @layoutdesign/context export --format <format> [--out <path>]`
 *
 * Emits the loaded .layout/ kit in another agent-context format:
 *   design-md    → DESIGN.md at the project root (Google design.md interop)
 *   agents-md    → AGENTS.md managed block (merge-or-create)
 *   claude-md    → CLAUDE.md managed block (merge-or-create)
 *   cursor       → .cursor/rules/layout.mdc
 *   codex-skill  → .codex/skills/<kit-name>/SKILL.md
 */
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { loadKit } from "../kit/loader.js";
import type { Kit } from "../kit/types.js";
import { generateDesignMd, type DesignMdProject } from "../export/design-md.js";
import { kitDesignTokens } from "../export/kit-tokens.js";
import {
  generateAgentContextBlock,
  generateCursorRuleMdc,
  generateCodexSkill,
} from "../export/agent-context.js";
import { applyManagedBlock } from "../export/managed-block.js";

export const EXPORT_FORMATS = [
  "design-md",
  "agents-md",
  "claude-md",
  "cursor",
  "codex-skill",
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportOptions {
  format: string;
  out?: string;
  /** Project directory containing .layout/ (default: cwd). */
  path?: string;
}

/** Map a loaded kit onto the shape the design.md emitter expects. */
export function kitToDesignMdProject(kit: Kit): DesignMdProject {
  const tokens = kitDesignTokens(kit);
  return {
    name: kit.manifest.displayName || kit.manifest.name,
    layoutMd: kit.layoutMd,
    ...(tokens ? { extractionData: { tokens } } : {}),
  };
}

/** Write `content` to `dest`, creating parent directories. */
function writeFileEnsuringDir(dest: string, content: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

/**
 * Run one export. Split from the CLI wrapper so tests can call it with an
 * explicit project root. Returns the path(s) written.
 */
export function runExport(
  projectRoot: string,
  format: ExportFormat,
  out?: string
): string[] {
  const kit = loadKit(projectRoot);
  if (!kit) {
    throw new Error(
      "No .layout/ directory found. Run `npx @layoutdesign/context init` first, or pass --path."
    );
  }

  switch (format) {
    case "design-md": {
      const dest = path.resolve(projectRoot, out ?? "DESIGN.md");
      writeFileEnsuringDir(dest, generateDesignMd(kitToDesignMdProject(kit)));
      return [dest];
    }
    case "agents-md":
    case "claude-md": {
      const fallback = format === "agents-md" ? "AGENTS.md" : "CLAUDE.md";
      const dest = path.resolve(projectRoot, out ?? fallback);
      applyManagedBlock(dest, generateAgentContextBlock(kit), {
        label: path.basename(dest),
        createIfMissing: true,
      });
      return [dest];
    }
    case "cursor": {
      const dest = path.resolve(
        projectRoot,
        out ?? path.join(".cursor", "rules", "layout.mdc")
      );
      writeFileEnsuringDir(dest, generateCursorRuleMdc(kit));
      return [dest];
    }
    case "codex-skill": {
      const fallback = path.join(".codex", "skills", kit.manifest.name, "SKILL.md");
      let dest = path.resolve(projectRoot, out ?? fallback);
      // --out may point at a directory; the skill file is always SKILL.md.
      if (!dest.toLowerCase().endsWith(".md")) dest = path.join(dest, "SKILL.md");
      writeFileEnsuringDir(dest, generateCodexSkill(kit));
      return [dest];
    }
  }
}

export async function exportCommand(options: ExportOptions): Promise<void> {
  const format = options.format as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    console.log(
      chalk.red("Error:"),
      `Unknown format "${options.format}". Use one of: ${EXPORT_FORMATS.join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  const projectRoot = path.resolve(options.path ?? process.cwd());

  let written: string[];
  try {
    written = runExport(projectRoot, format, options.out);
  } catch (err) {
    console.log(chalk.red("Error:"), err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  for (const dest of written) {
    console.log(
      chalk.green("✓"),
      `Exported ${chalk.bold(format)} → ${path.relative(projectRoot, dest) || dest}`
    );
  }
  if (format === "design-md") {
    console.log(
      chalk.dim(
        "  DESIGN.md is a companion file; .layout/layout.md stays the canonical source."
      )
    );
  }
}
