import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import {
  SUPERDUPER_DIR,
  KIT_MANIFEST_FILE,
  DESIGN_MD_FILE,
  TOKENS_CSS_FILE,
  TOKENS_JSON_FILE,
  TAILWIND_CONFIG_FILE,
} from "../kit/types.js";

/** Files we look for in the extracted ZIP and copy to .superduper/ */
const KNOWN_FILES = [
  KIT_MANIFEST_FILE,
  DESIGN_MD_FILE,
  TOKENS_CSS_FILE,
  TOKENS_JSON_FILE,
  TAILWIND_CONFIG_FILE,
  "CLAUDE.md",
  "agents.md",
] as const;

export async function importCommand(zipPath: string): Promise<void> {
  const resolvedPath = path.resolve(process.cwd(), zipPath);

  if (!fs.existsSync(resolvedPath)) {
    console.log(chalk.red("Error:"), `File not found: ${resolvedPath}`);
    process.exit(1);
  }

  if (!resolvedPath.endsWith(".zip")) {
    console.log(chalk.red("Error:"), "Expected a .zip file.");
    process.exit(1);
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superduperui-import-"));

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
  // AI Studio ZIPs may have files at root or nested in a single directory.
  const extractedRoot = findExtractedRoot(tmpDir);
  const targetDir = path.join(process.cwd(), SUPERDUPER_DIR);

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
    `Imported ${imported.length} item${imported.length === 1 ? "" : "s"} into .superduper/:`
  );
  console.log();

  for (const file of imported) {
    console.log(`  ${chalk.dim("•")} ${file}`);
  }

  console.log();
  console.log(
    `Run ${chalk.cyan("superduperui-context serve")} to start the MCP server.`
  );
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
