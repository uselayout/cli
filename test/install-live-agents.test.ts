/**
 * install --live also augments AGENTS.md / .cursorrules with the managed
 * block — but only when the project already has them. Idempotent.
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

test("CLAUDE.md created; AGENTS.md/.cursorrules augmented only if present", async () => {
  // AGENTS.md exists with prior content; .cursorrules does NOT exist.
  await fs.writeFile(path.join(dir, "AGENTS.md"), "# Agents\n\nexisting\n");

  await installLive(dir);

  const claude = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes(BEGIN), "CLAUDE.md created with block");

  const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith("# Agents"), "AGENTS.md prior content kept");
  assert.ok(agents.includes(BEGIN), "AGENTS.md augmented");

  // .cursorrules was absent → not created.
  await assert.rejects(fs.access(path.join(dir, ".cursorrules")));
});

test("re-running install --live is idempotent across all agent files", async () => {
  await fs.writeFile(path.join(dir, "AGENTS.md"), "# Agents\n");
  await fs.writeFile(path.join(dir, ".cursorrules"), "rules\n");

  await installLive(dir);
  const after1 = await Promise.all([
    fs.readFile(path.join(dir, "CLAUDE.md"), "utf8"),
    fs.readFile(path.join(dir, "AGENTS.md"), "utf8"),
    fs.readFile(path.join(dir, ".cursorrules"), "utf8"),
  ]);
  await installLive(dir);
  const after2 = await Promise.all([
    fs.readFile(path.join(dir, "CLAUDE.md"), "utf8"),
    fs.readFile(path.join(dir, "AGENTS.md"), "utf8"),
    fs.readFile(path.join(dir, ".cursorrules"), "utf8"),
  ]);
  assert.deepEqual(after2, after1, "second run is a no-op");
  for (const f of after2) {
    assert.equal(
      f.split(BEGIN).length - 1,
      1,
      "managed block present exactly once"
    );
  }
});
