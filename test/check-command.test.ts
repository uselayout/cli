/**
 * `check` CLI command: the CI compliance gate. Covers file collection and
 * exclusion, per-file findings with line numbers and suggestions, exit-code
 * logic (0 clean, 1 findings, 2 no kit), the --ci annotation format, the
 * --format json shape, and --changed against a fixture git repository.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";
import {
  collectFiles,
  isExcluded,
  globToRegExp,
  getChangedFiles,
  runCheck,
  resolveExitCode,
  formatCiAnnotations,
  formatJsonReport,
  formatHuman,
} from "../src/cli/check.js";
import { loadKit } from "../src/kit/loader.js";
import type { Kit } from "../src/kit/types.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// bin/cli.ts only runs from dist/ (its package.json require assumes the dist
// layout), so the exit-code tests spawn a thin harness that calls
// checkCommand directly. That is the same code path the bin wiring hits.
const runnerPath = path.resolve(here, "_run-check.ts");
const tsxImport = url.pathToFileURL(require.resolve("tsx")).href;

const TOKENS_CSS = `:root {
  --color-primary: #6366f1;
  --space-4: 16px;
}`;

/** Scaffold a project with a .layout/ kit and some source files. */
function makeProject(opts: { kit?: boolean; kitJson?: object } = { kit: true }): string {
  const root = mkdtempSync(join(tmpdir(), "layout-check-"));
  if (opts.kit !== false) {
    const layoutDir = join(root, ".layout");
    mkdirSync(layoutDir, { recursive: true });
    writeFileSync(join(layoutDir, "layout.md"), "# Test Kit\n");
    writeFileSync(join(layoutDir, "tokens.css"), TOKENS_CSS);
    if (opts.kitJson) {
      writeFileSync(join(layoutDir, "kit.json"), JSON.stringify(opts.kitJson, null, 2));
    }
  }
  return root;
}

function loadFixtureKit(root: string): Kit {
  const kit = loadKit(root);
  assert.ok(kit, "fixture kit should load");
  return kit;
}

const DIRTY_TSX = `export function Button() {
  return <button style={{ background: "#6466f0", color: "var(--color-primary)" }}>Go</button>;
}
`;

const CLEAN_CSS = `.button { background: var(--color-primary); }
`;

function runCli(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxImport, runnerPath, cwd, ...args],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, LAYOUT_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ── File selection ──────────────────────────────────────────────────────────

test("collectFiles keeps UI extensions and skips build output directories", async () => {
  const root = makeProject();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    mkdirSync(join(root, "build"), { recursive: true });
    mkdirSync(join(root, ".next"), { recursive: true });
    mkdirSync(join(root, "coverage"), { recursive: true });
    writeFileSync(join(root, "src", "App.tsx"), DIRTY_TSX);
    writeFileSync(join(root, "src", "styles.css"), CLEAN_CSS);
    writeFileSync(join(root, "src", "util.ts"), "export const x = 1;\n");
    writeFileSync(join(root, "node_modules", "pkg", "index.tsx"), DIRTY_TSX);
    writeFileSync(join(root, "dist", "out.css"), CLEAN_CSS);
    writeFileSync(join(root, "build", "out.jsx"), DIRTY_TSX);
    writeFileSync(join(root, ".next", "page.tsx"), DIRTY_TSX);
    writeFileSync(join(root, "coverage", "cov.html"), "<html></html>");

    const files = await collectFiles(root, [], []);
    const rel = files.map((f) => path.relative(root, f).split(path.sep).join("/"));
    assert.deepEqual(rel.sort(), ["src/App.tsx", "src/styles.css"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles honours explicit paths and always keeps explicit files", async () => {
  const root = makeProject();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "other"), { recursive: true });
    writeFileSync(join(root, "src", "A.tsx"), DIRTY_TSX);
    writeFileSync(join(root, "other", "B.tsx"), DIRTY_TSX);
    writeFileSync(join(root, "other", "notes.md"), "# hi\n");

    const scoped = await collectFiles(root, ["src"], []);
    assert.deepEqual(
      scoped.map((f) => path.relative(root, f)),
      [join("src", "A.tsx")],
    );

    // An explicitly named file is kept even without a default extension.
    const explicit = await collectFiles(root, [join("other", "notes.md")], []);
    assert.equal(explicit.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isExcluded matches directory prefixes, globs, and basenames", () => {
  assert.ok(isExcluded("src/vendor/lib.tsx", ["src/vendor"]));
  assert.ok(isExcluded("src/vendor/lib.tsx", ["src/vendor/**"]));
  assert.ok(isExcluded("src/Button.stories.tsx", ["*.stories.tsx"]));
  assert.ok(isExcluded("deep/nested/legacy/x.css", ["**/legacy/**"]));
  assert.ok(!isExcluded("src/Button.tsx", ["src/vendor", "*.stories.tsx"]));
  assert.ok(!isExcluded("src/Button.tsx", []));
});

test("globToRegExp keeps * within a path segment and ** across segments", () => {
  assert.ok(globToRegExp("src/*.css").test("src/a.css"));
  assert.ok(!globToRegExp("src/*.css").test("src/deep/a.css"));
  assert.ok(globToRegExp("src/**/*.css").test("src/deep/er/a.css"));
});

// ── Findings, line numbers, suggestions ─────────────────────────────────────

test("runCheck attaches file paths, file line numbers, and token suggestions", () => {
  const root = makeProject();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "App.tsx");
    writeFileSync(file, "// header\n\n" + DIRTY_TSX);
    const kit = loadFixtureKit(root);

    const result = runCheck([file], kit, root, {});
    const colour = result.issues.find((i) => i.ruleId === "hardcoded-colours");
    assert.ok(colour, "expected a hardcoded-colours finding");
    assert.equal(colour.file, "src/App.tsx");
    // The literal sits on line 4 of the file (whole file is passed through).
    assert.equal(colour.line, 4);
    assert.ok(typeof colour.column === "number" && colour.column > 1);
    // #6466f0 is a near miss for --color-primary (#6366f1).
    assert.equal(colour.suggestion?.token, "--color-primary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runCheck passes on a clean project", () => {
  const root = makeProject();
  try {
    const file = join(root, "styles.css");
    writeFileSync(file, CLEAN_CSS);
    const kit = loadFixtureKit(root);
    const result = runCheck([file], kit, root, {});
    assert.equal(result.exitCode, 0);
    assert.ok(result.passed);
    assert.equal(result.issues.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Exit-code logic ─────────────────────────────────────────────────────────

test("resolveExitCode gates on errors, --warnings-as-errors, and --max-warnings", () => {
  assert.equal(resolveExitCode(0, 0, {}), 0);
  assert.equal(resolveExitCode(1, 0, {}), 1);
  assert.equal(resolveExitCode(0, 5, {}), 0);
  assert.equal(resolveExitCode(0, 5, { warningsAsErrors: true }), 1);
  assert.equal(resolveExitCode(0, 5, { maxWarnings: 4 }), 1);
  assert.equal(resolveExitCode(0, 5, { maxWarnings: 5 }), 0);
  assert.equal(resolveExitCode(0, 0, { warningsAsErrors: true }), 0);
});

// ── Output formats ──────────────────────────────────────────────────────────

test("formatCiAnnotations emits GitHub Actions workflow commands and a summary", () => {
  const root = makeProject();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "App.tsx");
    writeFileSync(file, DIRTY_TSX);
    const kit = loadFixtureKit(root);

    const result = runCheck([file], kit, root, {});
    const out = formatCiAnnotations(result);
    assert.match(out, /^::warning file=src\/App\.tsx,line=\d+,col=\d+::/m);
    assert.match(out, /layout check: 1 file checked, /);

    // Under --warnings-as-errors the annotation kind is promoted too.
    const strict = formatCiAnnotations(result, true);
    assert.match(strict, /^::error file=src\/App\.tsx,/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatCiAnnotations escapes newlines and percent signs in messages", () => {
  const result = {
    exitCode: 1 as const,
    passed: false,
    filesChecked: 1,
    errors: 1,
    warnings: 0,
    info: 0,
    issues: [
      {
        file: "src/a,b.tsx",
        ruleId: "x",
        ruleName: "X",
        severity: "error" as const,
        message: "bad\nvalue 100%",
        line: 1,
      },
    ],
  };
  const out = formatCiAnnotations(result);
  assert.match(out, /file=src\/a%2Cb\.tsx/);
  assert.match(out, /bad%0Avalue 100%25/);
});

test("formatJsonReport has the { passed, files, issues } shape", () => {
  const root = makeProject();
  try {
    const file = join(root, "App.tsx");
    writeFileSync(file, DIRTY_TSX);
    const kit = loadFixtureKit(root);
    const parsed = JSON.parse(formatJsonReport(runCheck([file], kit, root, {})));

    assert.equal(typeof parsed.passed, "boolean");
    assert.equal(parsed.files, 1);
    assert.ok(Array.isArray(parsed.issues));
    const issue = parsed.issues.find(
      (i: { ruleId: string }) => i.ruleId === "hardcoded-colours",
    );
    assert.equal(issue.file, "App.tsx");
    assert.equal(issue.severity, "warning");
    assert.equal(typeof issue.line, "number");
    assert.equal(issue.suggestion.token, "--color-primary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatHuman includes the did-you-mean hint", () => {
  const root = makeProject();
  try {
    const file = join(root, "App.tsx");
    writeFileSync(file, DIRTY_TSX);
    const kit = loadFixtureKit(root);
    const out = formatHuman(runCheck([file], kit, root, {}));
    assert.match(out, /Did you mean var\(--color-primary\)\?/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── End-to-end CLI (exit codes) ─────────────────────────────────────────────

test("CLI exits 0 on a clean project", () => {
  const root = makeProject();
  try {
    writeFileSync(join(root, "styles.css"), CLEAN_CSS);
    const { status, stdout } = runCli(root, []);
    assert.equal(status, 0);
    assert.match(stdout, /no issues/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exits 1 when findings fail the gate (--warnings-as-errors)", () => {
  const root = makeProject();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "App.tsx"), DIRTY_TSX);
    const { status, stdout } = runCli(root, ["--warnings-as-errors"]);
    assert.equal(status, 1);
    assert.match(stdout, /hardcoded-colours/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exits 2 when no kit is found (setup error, not a pass)", () => {
  const root = makeProject({ kit: false });
  try {
    writeFileSync(join(root, "App.tsx"), DIRTY_TSX);
    const { status, stderr } = runCli(root, []);
    assert.equal(status, 2);
    assert.match(stderr, /No \.layout\/ directory found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI --ci emits annotations and still exits 1 on gate failure", () => {
  const root = makeProject();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "App.tsx"), DIRTY_TSX);
    const { status, stdout } = runCli(root, ["--ci", "--warnings-as-errors"]);
    assert.equal(status, 1);
    assert.match(stdout, /^::error file=src\/App\.tsx,line=\d+,col=\d+::/m);
    assert.match(stdout, /layout check: /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI honours check.exclude from .layout/kit.json", () => {
  const root = makeProject({
    kit: true,
    kitJson: {
      name: "test",
      version: "1.0.0",
      displayName: "Test",
      description: "fixture",
      source: "test",
      tier: "free",
      tokenCount: 0,
      componentCount: 0,
      aesthetic: "test",
      check: { exclude: ["src/vendor/**"] },
    },
  });
  try {
    mkdirSync(join(root, "src", "vendor"), { recursive: true });
    writeFileSync(join(root, "src", "vendor", "Lib.tsx"), DIRTY_TSX);
    writeFileSync(join(root, "src", "Clean.css"), CLEAN_CSS);
    const { status } = runCli(root, ["--warnings-as-errors"]);
    assert.equal(status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── --changed ───────────────────────────────────────────────────────────────

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "getChangedFiles lists only files changed vs the base ref",
  { skip: gitAvailable() ? false : "git not available" },
  () => {
    const root = makeProject();
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, stdio: "ignore" });
      git("init", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      writeFileSync(join(root, "Clean.css"), CLEAN_CSS);
      git("add", "-A");
      git("commit", "-m", "base");
      writeFileSync(join(root, "New.tsx"), DIRTY_TSX);
      writeFileSync(join(root, "notes.md"), "# not a UI file\n");
      git("add", "-A");
      git("commit", "-m", "change");

      const changed = getChangedFiles(root, "HEAD~1");
      assert.ok(changed, "expected a change list inside a git repo");
      assert.deepEqual(
        changed.map((f) => path.relative(root, f)),
        ["New.tsx"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "getChangedFiles resolves toplevel-relative git paths when the project is a repo subdirectory",
  { skip: gitAvailable() ? false : "git not available" },
  () => {
    // Monorepo shape: the repository toplevel is NOT the project root. git
    // prints changed paths relative to the toplevel, so resolving them
    // against the project root used to double the path, drop every file,
    // and let the gate pass with 0 files checked.
    const repo = mkdtempSync(join(tmpdir(), "layout-check-mono-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repo, stdio: "ignore" });
      git("init", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");

      const project = join(repo, "packages", "app");
      mkdirSync(join(project, ".layout"), { recursive: true });
      writeFileSync(join(project, ".layout", "layout.md"), "# Test Kit\n");
      writeFileSync(join(project, ".layout", "tokens.css"), TOKENS_CSS);
      writeFileSync(join(project, "Clean.css"), CLEAN_CSS);
      git("add", "-A");
      git("commit", "-m", "base");

      mkdirSync(join(project, "src"), { recursive: true });
      writeFileSync(join(project, "src", "New.tsx"), DIRTY_TSX);
      // A change outside the project root is not checkable and is dropped.
      writeFileSync(join(repo, "Outside.tsx"), DIRTY_TSX);
      git("add", "-A");
      git("commit", "-m", "change");

      const changed = getChangedFiles(project, "HEAD~1");
      assert.ok(changed, "expected a change list inside a git repo");
      assert.deepEqual(
        changed.map((f) => path.relative(project, f).split(path.sep).join("/")),
        ["src/New.tsx"],
      );

      // End to end: the gate fails on the changed dirty file instead of
      // passing with zero files checked.
      const { status, stdout } = runCli(project, [
        "--changed",
        "--base",
        "HEAD~1",
        "--warnings-as-errors",
      ]);
      assert.equal(status, 1);
      assert.match(stdout, /hardcoded-colours/);
      assert.match(stdout, /1 file checked/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  },
);

test("getChangedFiles returns null when the base ref cannot be resolved", () => {
  const root = makeProject();
  try {
    assert.equal(getChangedFiles(root, "no-such-ref-xyz"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
