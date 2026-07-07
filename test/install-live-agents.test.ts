/**
 * install --live writes the managed block to all agent files: CLAUDE.md and
 * AGENTS.md are created when absent; Cursor gets .cursorrules augmented when
 * it exists, otherwise a .cursor/rules/layout-live.mdc rule is created.
 * Idempotent.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installLive } from "../src/install/live.js";

let dir = "";
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ila-"));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", devDependencies: { vite: "^5" } })
  );
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const BEGIN = "<!-- BEGIN layout-live (managed) -->";

test("CLAUDE.md and AGENTS.md created when absent; existing AGENTS.md augmented", async () => {
  await installLive(dir);

  const claude = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes(BEGIN), "CLAUDE.md created with block");

  const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
  assert.ok(agents.includes(BEGIN), "AGENTS.md created with block");

  // Existing AGENTS.md content is preserved on augmentation.
  await fs.writeFile(path.join(dir, "AGENTS.md"), "# Agents\n\nexisting\n");
  await installLive(dir);
  const augmented = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
  assert.ok(augmented.startsWith("# Agents"), "AGENTS.md prior content kept");
  assert.ok(augmented.includes("existing"));
  assert.ok(augmented.includes(BEGIN), "AGENTS.md augmented");
});

test("no .cursorrules -> .cursor/rules/layout-live.mdc created", async () => {
  await installLive(dir);

  // Legacy .cursorrules was absent and stays absent.
  await assert.rejects(fs.access(path.join(dir, ".cursorrules")));

  const rule = await fs.readFile(
    path.join(dir, ".cursor", "rules", "layout-live.mdc"),
    "utf8"
  );
  assert.ok(rule.startsWith("---\ndescription:"), "mdc frontmatter");
  assert.ok(rule.includes("alwaysApply: true"));
  assert.ok(rule.includes(BEGIN), "carries the managed block");
});

test("existing .cursorrules is augmented; no .cursor/rules file created", async () => {
  await fs.writeFile(path.join(dir, ".cursorrules"), "rules\n");
  await installLive(dir);

  const cursorrules = await fs.readFile(path.join(dir, ".cursorrules"), "utf8");
  assert.ok(cursorrules.startsWith("rules"), "prior content kept");
  assert.ok(cursorrules.includes(BEGIN), "augmented");

  await assert.rejects(
    fs.access(path.join(dir, ".cursor", "rules", "layout-live.mdc"))
  );
});

test("re-running install --live is idempotent across all agent files", async () => {
  await fs.writeFile(path.join(dir, "AGENTS.md"), "# Agents\n");
  await installLive(dir);
  const files = [
    path.join(dir, "CLAUDE.md"),
    path.join(dir, "AGENTS.md"),
    path.join(dir, ".cursor", "rules", "layout-live.mdc"),
  ];
  const after1 = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
  await installLive(dir);
  const after2 = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
  assert.deepEqual(after2, after1, "second run is a no-op");
  for (const f of after2) {
    assert.equal(
      f.split(BEGIN).length - 1,
      1,
      "managed block present exactly once"
    );
  }
});
