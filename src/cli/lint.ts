import { loadKit } from "../kit/loader.js";
import { stageKitReference } from "../kit/stage.js";
import { lintKit, type LintIssue, type LintResult } from "../lint/layout-md.js";

// ANSI colour helpers kept inline so the CLI stays dependency-free.
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function colourForSeverity(severity: LintIssue["severity"]): string {
  if (severity === "error") return RED;
  if (severity === "warning") return YELLOW;
  return BLUE;
}

function symbolFor(severity: LintIssue["severity"]): string {
  if (severity === "error") return "✖";
  if (severity === "warning") return "⚠";
  return "ℹ";
}

export interface LintCommandOptions {
  json?: boolean;
  path?: string;
  quiet?: boolean;
}

export async function lintCommand(options: LintCommandOptions = {}): Promise<void> {
  const prepared = stageKitReference(options.path);
  const kit = loadKit(prepared.path);
  const cleanup = prepared.cleanup;
  if (!kit) {
    cleanup();
    const message = options.path
      ? `No .layout/ directory found at ${options.path}`
      : "No .layout/ directory found. Run `layout-context init` first.";
    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          { error: "kit-not-found", message, issues: [], summary: { errors: 1, warnings: 0, info: 0, passed: false } },
          null,
          2,
        ) + "\n",
      );
    } else {
      process.stderr.write(`${RED}${message}${RESET}\n`);
    }
    process.exit(1);
  }

  const result = lintKit(kit);
  cleanup();

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printHuman(result, options.quiet ?? false);
  }

  process.exit(result.summary.passed ? 0 : 1);
}

function printHuman(result: LintResult, quiet: boolean): void {
  const { issues, summary } = result;
  const filtered = quiet ? issues.filter((i) => i.severity !== "info") : issues;

  if (filtered.length === 0) {
    process.stdout.write(`${BOLD}layout lint${RESET}  ${BLUE}✔${RESET}  no issues\n`);
    return;
  }

  const byFile = new Map<string, LintIssue[]>();
  for (const issue of filtered) {
    const key = issue.file ?? "(kit)";
    const arr = byFile.get(key) ?? [];
    arr.push(issue);
    byFile.set(key, arr);
  }

  for (const [file, fileIssues] of byFile) {
    process.stdout.write(`\n${BOLD}${file}${RESET}\n`);
    for (const issue of fileIssues) {
      const colour = colourForSeverity(issue.severity);
      const sym = symbolFor(issue.severity);
      const loc = issue.line ? `${DIM}L${issue.line}${RESET}  ` : "";
      process.stdout.write(`  ${colour}${sym}${RESET}  ${loc}${issue.message}  ${DIM}(${issue.ruleId})${RESET}\n`);
    }
  }

  process.stdout.write(
    `\n${BOLD}${summary.errors} errors${RESET}  ${summary.warnings} warnings  ${summary.info} info\n`,
  );

  if (!summary.passed) {
    process.stdout.write(`${RED}layout lint failed${RESET}\n`);
  }
}
