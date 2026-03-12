import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import {
  LAYOUT_DIR,
  KIT_MANIFEST_FILE,
  DESIGN_MD_FILE,
  TOKENS_CSS_FILE,
  TOKENS_JSON_FILE,
  TAILWIND_CONFIG_FILE,
} from "../kit/types.js";

/** Files we look for in the extracted ZIP and copy to .layout/ */
const KNOWN_FILES = [
  KIT_MANIFEST_FILE,
  DESIGN_MD_FILE,
  TOKENS_CSS_FILE,
  TOKENS_JSON_FILE,
  TAILWIND_CONFIG_FILE,
  "CLAUDE.md",
  "agents.md",
] as const;

/** Markers used to find/replace the design system section in root CLAUDE.md */
const SECTION_START = "<!-- layout:design-system:start -->";
const SECTION_END = "<!-- layout:design-system:end -->";

export async function importCommand(zipPath: string): Promise<void> {
  const cwd = process.cwd();
  const resolvedPath = path.resolve(cwd, zipPath);

  if (!fs.existsSync(resolvedPath)) {
    console.log(chalk.red("Error:"), `File not found: ${resolvedPath}`);
    process.exit(1);
  }

  if (!resolvedPath.endsWith(".zip")) {
    console.log(chalk.red("Error:"), "Expected a .zip file.");
    process.exit(1);
  }

  // Check we're in a project directory, not somewhere random
  const projectMarkers = ["package.json", ".git", "CLAUDE.md", "Cargo.toml", "pyproject.toml", "go.mod", "Gemfile"];
  const isProjectDir = projectMarkers.some((m) => fs.existsSync(path.join(cwd, m)));

  if (!isProjectDir) {
    console.log(
      chalk.yellow("Warning:"),
      "This doesn't look like a project directory."
    );
    console.log(
      chalk.dim(`  Run this from your project root (e.g. where package.json lives).`)
    );
    console.log(
      chalk.dim(`  Current directory: ${cwd}`)
    );
    console.log();
  }

  // Check that unzip is available
  try {
    execFileSync("which", ["unzip"], { stdio: "ignore" });
  } catch {
    console.log(
      chalk.red("Error:"),
      "The 'unzip' command is required but not found."
    );
    console.log(
      `  Install it with: ${chalk.cyan("sudo apt install unzip")} (Linux) or ${chalk.cyan("brew install unzip")} (macOS)`
    );
    process.exit(1);
  }

  // Extract to a temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-import-"));

  try {
    execFileSync("unzip", ["-o", "-q", resolvedPath, "-d", tmpDir], {
      stdio: "ignore",
    });
  } catch {
    console.log(chalk.red("Error:"), "Failed to extract ZIP file.");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Find the root of the extracted content.
  // Layout ZIPs may have files at root or nested in a single directory.
  const extractedRoot = findExtractedRoot(tmpDir);
  const targetDir = path.join(process.cwd(), LAYOUT_DIR);

  fs.mkdirSync(targetDir, { recursive: true });

  const imported: string[] = [];

  for (const fileName of KNOWN_FILES) {
    const srcPath = path.join(extractedRoot, fileName);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(targetDir, fileName));
      imported.push(fileName);
    }
  }

  // Copy components directory if it exists
  const componentsSrc = path.join(extractedRoot, "components");
  if (fs.existsSync(componentsSrc) && fs.statSync(componentsSrc).isDirectory()) {
    const componentsDest = path.join(targetDir, "components");
    fs.cpSync(componentsSrc, componentsDest, { recursive: true });
    imported.push("components/");
  }

  // Copy cursor rules if present
  const cursorSrc = path.join(extractedRoot, ".cursor");
  if (fs.existsSync(cursorSrc) && fs.statSync(cursorSrc).isDirectory()) {
    const cursorDest = path.join(targetDir, ".cursor");
    fs.cpSync(cursorSrc, cursorDest, { recursive: true });
    imported.push(".cursor/");
  }

  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (imported.length === 0) {
    console.log(
      chalk.yellow("Warning:"),
      "No recognised design system files found in the ZIP."
    );
    console.log(
      `  Expected files: ${KNOWN_FILES.join(", ")}`
    );
    return;
  }

  console.log(
    chalk.green("✓"),
    `Imported ${imported.length} item${imported.length === 1 ? "" : "s"} into .layout/:`
  );
  console.log();

  for (const file of imported) {
    console.log(`  ${chalk.dim("•")} ${file}`);
  }

  // Merge design system rules into root CLAUDE.md
  const mergedClaudeMd = mergeIntoRootClaudeMd();
  if (mergedClaudeMd) {
    console.log(`  ${chalk.dim("•")} ${mergedClaudeMd}`);
  }

  console.log();
  console.log(
    `Run ${chalk.cyan("npx @layoutdesign/context install")} to connect the MCP server.`
  );
}

/**
 * Merge the .layout/CLAUDE.md content into the project's root CLAUDE.md.
 * Uses HTML comment markers so re-imports replace the previous section.
 * Returns a description string for the import log, or null if nothing was merged.
 */
function mergeIntoRootClaudeMd(): string | null {
  const layoutClaudeMd = path.join(process.cwd(), LAYOUT_DIR, "CLAUDE.md");
  if (!fs.existsSync(layoutClaudeMd)) return null;

  const designSection = fs.readFileSync(layoutClaudeMd, "utf-8").trim();
  if (!designSection) return null;

  const wrappedSection = `${SECTION_START}\n${designSection}\n${SECTION_END}`;
  const rootClaudeMd = path.join(process.cwd(), "CLAUDE.md");

  if (fs.existsSync(rootClaudeMd)) {
    const existing = fs.readFileSync(rootClaudeMd, "utf-8");

    // Replace existing section if present
    const startIdx = existing.indexOf(SECTION_START);
    const endIdx = existing.indexOf(SECTION_END);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + SECTION_END.length);
      fs.writeFileSync(rootClaudeMd, before + wrappedSection + after);
      return "CLAUDE.md (updated design system section)";
    }

    // Append to end
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(rootClaudeMd, existing + separator + wrappedSection + "\n");
    return "CLAUDE.md (appended design system section)";
  }

  // No root CLAUDE.md — create one
  fs.writeFileSync(rootClaudeMd, wrappedSection + "\n");
  return "CLAUDE.md (created with design system section)";
}

/**
 * If the ZIP contains a single top-level directory, return that.
 * Otherwise return the tmpDir itself.
 */
function findExtractedRoot(tmpDir: string): string {
  const entries = fs.readdirSync(tmpDir).filter((e) => !e.startsWith("."));

  if (entries.length === 1) {
    const single = path.join(tmpDir, entries[0]!);
    if (fs.statSync(single).isDirectory()) {
      return single;
    }
  }

  return tmpDir;
}
