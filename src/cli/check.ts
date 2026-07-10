/**
 * `layout-context check` : the CI compliance gate.
 *
 * Scans project UI source files, runs the same compliance rules that power
 * Layout Live and the `check_compliance` MCP tool against the active kit,
 * and fails the build when violations are found. Enforcement that only
 * exists inside a desktop app enforces nothing when the app is closed, so
 * this command puts the identical engine into CI.
 *
 * Exit codes:
 *   0 : scan ran, gate passed
 *   1 : scan ran, gate failed (errors, or warnings under --warnings-as-errors
 *       or above --max-warnings)
 *   2 : setup error (no kit found, invalid flag values). No kit in CI is a
 *       setup error, not a pass.
 */
import { resolve, relative, extname, isAbsolute, sep } from "node:path";
import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadKit } from "../kit/loader.js";
import type { Kit } from "../kit/types.js";
import { checkCompliance } from "../compliance/checker.js";
import type { ComplianceIssue } from "../compliance/checker.js";
import { walkDir } from "../integrations/codebase-scan.js";

// ANSI colour helpers kept inline so the CLI stays dependency-free (mirrors lint.ts).
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

/** File extensions the gate scans by default. */
export const CHECK_EXTENSIONS = new Set([
  ".tsx",
  ".jsx",
  ".html",
  ".css",
  ".vue",
  ".svelte",
]);

export const DEFAULT_CHANGED_BASE = "origin/main";

export interface CheckOptions {
  /** Emit GitHub Actions workflow annotations plus a summary line. */
  ci?: boolean;
  /** Output format: "text" (default) or "json". */
  format?: string;
  /** Treat warnings as errors for the exit code (and CI annotation kind). */
  warningsAsErrors?: boolean;
  /** Fail when the warning count exceeds this number. */
  maxWarnings?: number;
  /** Glob patterns to skip, merged with `check.exclude` from .layout/kit.json. */
  exclude?: string[];
  /** Only check files changed vs the base ref (git diff <base>...HEAD). */
  changed?: boolean;
  /** Base ref for --changed. Default: origin/main. */
  base?: string;
  /** Project directory containing .layout/ (default: cwd). */
  path?: string;
}

/** A compliance issue with the project-relative file it was found in. */
export interface FileIssue extends ComplianceIssue {
  file: string;
}

export interface CheckRunResult {
  exitCode: 0 | 1;
  passed: boolean;
  filesChecked: number;
  issues: FileIssue[];
  errors: number;
  warnings: number;
  info: number;
}

// ── Exclusion matching ──────────────────────────────────────────────────────

/**
 * Convert a simple glob to a RegExp. Supports `**` (any path), `*` (any chars
 * within a segment) and `?` (one char within a segment). No brace or
 * character-class support: this is a gate, not a bundler.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * True when a project-relative path matches any exclude pattern. A pattern
 * matches when it globs the full relative path or the basename, or when it
 * names a directory prefix (e.g. "src/vendor").
 */
export function isExcluded(relPath: string, excludes: string[]): boolean {
  if (excludes.length === 0) return false;
  const posix = relPath.split(sep).join("/");
  const base = posix.split("/").pop() ?? posix;

  for (const raw of excludes) {
    const pattern = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (pattern.length === 0) continue;
    if (posix === pattern || posix.startsWith(pattern + "/")) return true;
    const re = globToRegExp(pattern);
    if (re.test(posix) || re.test(base)) return true;
  }
  return false;
}

// ── File selection ──────────────────────────────────────────────────────────

/**
 * Collect the files to check. With no paths, walks the project root
 * (reusing the codebase scanner's walker, which already skips node_modules,
 * dist, build, .next, coverage and other output directories) and keeps
 * files with a UI source extension. Explicit file paths are always kept;
 * explicit directories are walked with the extension filter applied.
 */
export async function collectFiles(
  root: string,
  paths: string[],
  excludes: string[],
): Promise<string[]> {
  const targets =
    paths.length > 0
      ? paths.map((p) => (isAbsolute(p) ? p : resolve(root, p)))
      : [root];

  const seen = new Set<string>();
  const files: string[] = [];

  const push = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (isExcluded(relative(root, file), excludes)) return;
    files.push(file);
  };

  for (const target of targets) {
    if (!existsSync(target)) continue;
    const stat = statSync(target);
    if (stat.isFile()) {
      push(target);
      continue;
    }
    for await (const file of walkDir(target)) {
      if (CHECK_EXTENSIONS.has(extname(file).toLowerCase())) push(file);
    }
  }

  files.sort();
  return files;
}

/**
 * Files changed vs a base ref, via `git diff --name-only <base>...HEAD`.
 * git prints paths relative to the repository toplevel, NOT the cwd, so
 * they are resolved against `git rev-parse --show-toplevel` and filtered to
 * files under the project root: in a monorepo the project (and its .layout/)
 * may live in a subdirectory of the repository, and resolving against the
 * project root would double the path and silently drop every changed file.
 * Returns absolute paths of files that still exist and have a checkable
 * extension. Returns null when git fails (not a repo, missing base ref),
 * so the caller can degrade gracefully.
 */
export function getChangedFiles(root: string, base: string): string[] | null {
  try {
    const toplevel = execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    // git resolves symlinks in the toplevel (macOS /var → /private/var), so
    // locate the project inside the repository via its real path. "" when
    // the project root IS the toplevel (the single-repo case).
    const prefix = relative(toplevel, realpathSync(root));
    const out = execFileSync(
      "git",
      ["diff", "--name-only", `${base}...HEAD`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) =>
        resolve(root, prefix.length > 0 ? relative(prefix, file) : file),
      )
      .filter(
        (file) =>
          file.startsWith(root + sep) &&
          CHECK_EXTENSIONS.has(extname(file).toLowerCase()) &&
          existsSync(file),
      );
  } catch {
    return null;
  }
}

// ── Running the rules ───────────────────────────────────────────────────────

/**
 * Run checkCompliance over each file and attach the project-relative path to
 * every issue. Whole files are passed to the checker, so issue line numbers
 * are already file line numbers (and columns are 1-based within the line).
 */
export function runCheck(
  files: string[],
  kit: Kit,
  root: string,
  options: Pick<CheckOptions, "warningsAsErrors" | "maxWarnings">,
): CheckRunResult {
  const issues: FileIssue[] = [];

  for (const file of files) {
    let code: string;
    try {
      code = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const result = checkCompliance(code, kit);
    const rel = (relative(root, file) || file).split(sep).join("/");
    for (const issue of result.issues) {
      issues.push({ file: rel, ...issue });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;
  const exitCode = resolveExitCode(errors, warnings, options);

  return {
    exitCode,
    passed: exitCode === 0,
    filesChecked: files.length,
    issues,
    errors,
    warnings,
    info,
  };
}

/**
 * Gate logic: errors always fail; warnings fail only under
 * --warnings-as-errors or when they exceed --max-warnings.
 */
export function resolveExitCode(
  errors: number,
  warnings: number,
  options: Pick<CheckOptions, "warningsAsErrors" | "maxWarnings">,
): 0 | 1 {
  if (errors > 0) return 1;
  if (options.warningsAsErrors && warnings > 0) return 1;
  if (options.maxWarnings !== undefined && warnings > options.maxWarnings) {
    return 1;
  }
  return 0;
}

// ── Output formats ──────────────────────────────────────────────────────────

function suggestionHint(issue: ComplianceIssue): string {
  if (!issue.suggestion) return "";
  return ` Did you mean var(${issue.suggestion.token})?`;
}

/** Escape message data for GitHub Actions workflow commands. */
function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escape property values (file paths) for GitHub Actions workflow commands. */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function summaryLine(result: CheckRunResult): string {
  const counts = `${result.errors} error${result.errors === 1 ? "" : "s"}, ${result.warnings} warning${result.warnings === 1 ? "" : "s"}, ${result.info} info`;
  return `layout check: ${result.filesChecked} file${result.filesChecked === 1 ? "" : "s"} checked, ${counts}. ${result.passed ? "Passed." : "Failed."}`;
}

/**
 * GitHub Actions annotations: one ::error/::warning/::notice line per issue
 * (so findings appear inline on the PR diff), then a plain summary line.
 */
export function formatCiAnnotations(
  result: CheckRunResult,
  warningsAsErrors = false,
): string {
  const lines: string[] = [];

  for (const issue of result.issues) {
    const kind =
      issue.severity === "error" ||
      (warningsAsErrors && issue.severity === "warning")
        ? "error"
        : issue.severity === "warning"
          ? "warning"
          : "notice";

    const props = [`file=${escapeProperty(issue.file)}`];
    if (issue.line !== undefined) props.push(`line=${issue.line}`);
    if (issue.column !== undefined) props.push(`col=${issue.column}`);

    lines.push(
      `::${kind} ${props.join(",")}::${escapeData(issue.message + suggestionHint(issue))}`,
    );
  }

  lines.push(summaryLine(result));
  return lines.join("\n");
}

/** Machine-readable report: { passed, files, issues }. */
export function formatJsonReport(result: CheckRunResult): string {
  return JSON.stringify(
    {
      passed: result.passed,
      files: result.filesChecked,
      issues: result.issues,
    },
    null,
    2,
  );
}

/** Human-readable findings grouped by file (mirrors `lint`'s output style). */
export function formatHuman(result: CheckRunResult): string {
  const lines: string[] = [];

  if (result.issues.length === 0) {
    lines.push(
      `${BOLD}layout check${RESET}  ${GREEN}✔${RESET}  ${result.filesChecked} file${result.filesChecked === 1 ? "" : "s"} checked, no issues`,
    );
    return lines.join("\n");
  }

  const byFile = new Map<string, FileIssue[]>();
  for (const issue of result.issues) {
    const arr = byFile.get(issue.file) ?? [];
    arr.push(issue);
    byFile.set(issue.file, arr);
  }

  for (const [file, fileIssues] of byFile) {
    lines.push("", `${BOLD}${file}${RESET}`);
    for (const issue of fileIssues) {
      const colour =
        issue.severity === "error"
          ? RED
          : issue.severity === "warning"
            ? YELLOW
            : BLUE;
      const symbol =
        issue.severity === "error"
          ? "✖"
          : issue.severity === "warning"
            ? "⚠"
            : "ℹ";
      const loc =
        issue.line !== undefined
          ? `${DIM}L${issue.line}${issue.column !== undefined ? `:C${issue.column}` : ""}${RESET}  `
          : "";
      const hint = issue.suggestion
        ? `  ${DIM}Did you mean var(${issue.suggestion.token})?${RESET}`
        : "";
      lines.push(
        `  ${colour}${symbol}${RESET}  ${loc}${issue.message}${hint}  ${DIM}(${issue.ruleId})${RESET}`,
      );
    }
  }

  lines.push("", summaryLine(result));
  return lines.join("\n");
}

// ── Command entry point ─────────────────────────────────────────────────────

function fail(message: string, options: CheckOptions): never {
  if (options.format === "json") {
    process.stdout.write(
      JSON.stringify(
        { error: "setup", message, passed: false, files: 0, issues: [] },
        null,
        2,
      ) + "\n",
    );
  } else if (options.ci) {
    process.stdout.write(`::error::${escapeData(message)}\n`);
  }
  process.stderr.write(`${RED}${message}${RESET}\n`);
  process.exit(2);
}

export async function checkCommand(
  paths: string[],
  options: CheckOptions = {},
): Promise<void> {
  const root = resolve(options.path ?? process.cwd());

  if (options.format !== undefined && !["text", "json"].includes(options.format)) {
    fail(`Unknown format "${options.format}". Use text or json.`, options);
  }
  if (options.maxWarnings !== undefined && Number.isNaN(options.maxWarnings)) {
    fail("--max-warnings expects a number.", options);
  }

  const kit = loadKit(root);
  if (!kit) {
    fail(
      `No .layout/ directory found at ${root}. The compliance gate needs a kit to check against: run \`npx @layoutdesign/context init\` (or commit your .layout/ directory) first.`,
      options,
    );
  }

  const excludes = [
    ...(kit.manifest.check?.exclude ?? []),
    ...(options.exclude ?? []),
  ];

  let files: string[];
  if (options.changed) {
    const base = options.base ?? DEFAULT_CHANGED_BASE;
    const changed = getChangedFiles(root, base);
    if (changed === null) {
      process.stderr.write(
        `${YELLOW}Could not resolve files changed vs ${base} (not a git repository, or the base ref is missing). Falling back to a full scan.${RESET}\n`,
      );
      files = await collectFiles(root, paths, excludes);
    } else {
      const scopes =
        paths.length > 0
          ? paths.map((p) => (isAbsolute(p) ? p : resolve(root, p)))
          : null;
      files = changed.filter((file) => {
        if (isExcluded(relative(root, file), excludes)) return false;
        if (!scopes) return true;
        return scopes.some(
          (scope) => file === scope || file.startsWith(scope + sep),
        );
      });
    }
  } else {
    files = await collectFiles(root, paths, excludes);
  }

  const result = runCheck(files, kit, root, options);

  if (options.format === "json") {
    process.stdout.write(formatJsonReport(result) + "\n");
  } else if (options.ci) {
    process.stdout.write(
      formatCiAnnotations(result, options.warningsAsErrors ?? false) + "\n",
    );
  } else {
    process.stdout.write(formatHuman(result) + "\n");
  }

  process.exit(result.exitCode);
}
