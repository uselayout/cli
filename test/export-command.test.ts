/**
 * `export` command: each format writes to its conventional location,
 * merge-or-create formats preserve existing content, and re-runs are
 * idempotent. Runs against a real bundled kit staged into a temp project.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { existsSync, cpSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runExport } from "../src/cli/export.js";

const KIT_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "kits",
  "linear-lite"
);

let dir = "";
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "layout-export-"));
  const layoutDir = path.join(dir, ".layout");
  mkdirSync(layoutDir, { recursive: true });
  cpSync(KIT_SRC, layoutDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("design-md writes DESIGN.md at the project root", async () => {
  const [dest] = runExport(dir, "design-md");
  assert.equal(dest, path.join(dir, "DESIGN.md"));
  const content = await fs.readFile(dest!, "utf8");
  assert.ok(content.startsWith("---\n"), "has YAML frontmatter");
  assert.ok(content.includes("generator: \"Layout (layout.design)\""));
  assert.ok(content.includes("colors:"), "token frontmatter present");
  assert.ok(
    content.includes("# Linear — Design System"),
    "layout.md body included"
  );
});

test("agents-md creates AGENTS.md when absent and preserves existing content", async () => {
  runExport(dir, "agents-md");
  const created = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
  assert.ok(created.includes("<!-- BEGIN layout design system (managed) -->"));
  assert.ok(created.includes("--linear-bg-app: #0A0A0F;"), "token quick ref");

  // Now with pre-existing content: block appended, prior content kept.
  await fs.writeFile(path.join(dir, "AGENTS.md"), "# My agents\n\nkeep me\n");
  runExport(dir, "agents-md");
  const merged = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
  assert.ok(merged.startsWith("# My agents"), "existing content preserved");
  assert.ok(merged.includes("keep me"));
  assert.ok(merged.includes("<!-- BEGIN layout design system (managed) -->"));

  // Idempotent: re-running changes nothing.
  runExport(dir, "agents-md");
  const again = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
  assert.equal(again, merged);
});

test("claude-md merges into CLAUDE.md", async () => {
  await fs.writeFile(path.join(dir, "CLAUDE.md"), "# Project\n");
  runExport(dir, "claude-md");
  const content = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
  assert.ok(content.startsWith("# Project"));
  assert.ok(content.includes("## Design system: Linear"));
});

test("cursor writes .cursor/rules/layout.mdc with frontmatter", async () => {
  const [dest] = runExport(dir, "cursor");
  assert.equal(dest, path.join(dir, ".cursor", "rules", "layout.mdc"));
  const content = await fs.readFile(dest!, "utf8");
  assert.ok(content.startsWith("---\ndescription:"));
  assert.ok(content.includes("alwaysApply: true"));
  assert.ok(content.includes("## Design system: Linear"));
});

test("codex-skill writes .codex/skills/<kit>/SKILL.md without frontmatter", async () => {
  const [dest] = runExport(dir, "codex-skill");
  assert.equal(
    dest,
    path.join(dir, ".codex", "skills", "linear-lite", "SKILL.md")
  );
  const content = await fs.readFile(dest!, "utf8");
  assert.ok(
    content.startsWith("# Linear design system"),
    "frontmatter-less title"
  );
  assert.ok(content.includes("## Purpose"));
  assert.ok(content.includes("## When to invoke"));
  assert.ok(content.includes("## Token quick reference"));
  assert.ok(content.includes("npx -y @layoutdesign/context serve"));
});

test("--out overrides the destination", async () => {
  const [dest] = runExport(dir, "design-md", path.join("docs", "design.md"));
  assert.equal(dest, path.join(dir, "docs", "design.md"));
  assert.ok(existsSync(dest!));
});

test("throws a clear error when no kit is loaded", async () => {
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "layout-empty-"));
  try {
    assert.throws(() => runExport(empty, "design-md"), /No \.layout\/ directory/);
  } finally {
    await fs.rm(empty, { recursive: true, force: true });
  }
});
