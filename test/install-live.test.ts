/**
 * install --live flow: framework detection, config patching (recast),
 * .layout/live/ scaffold, CLAUDE.md managed block — all idempotent.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectFramework,
  installLive,
  detectPackageManager,
  hasLayoutDependency,
  ensureDependency,
} from "../src/install/live.js";

let tmp: string;
let origCwd: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-live-install-"));
});
afterEach(async () => {
  process.chdir(origCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writePkg(deps: Record<string, string>) {
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "fix", dependencies: deps }, null, 2)
  );
}

test("detectPackageManager reads the lockfile", async () => {
  assert.equal(detectPackageManager(tmp), "npm"); // no lockfile → npm
  await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "");
  assert.equal(detectPackageManager(tmp), "pnpm");
  await fs.rm(path.join(tmp, "pnpm-lock.yaml"));
  await fs.writeFile(path.join(tmp, "yarn.lock"), "");
  assert.equal(detectPackageManager(tmp), "yarn");
});

test("hasLayoutDependency detects a declared dep", async () => {
  await writePkg({ next: "15.0.0" });
  assert.equal(hasLayoutDependency(tmp), false);
  await writePkg({ next: "15.0.0", "@layoutdesign/context": "0.13.0" });
  assert.equal(hasLayoutDependency(tmp), true);
});

test("ensureDependency is a no-op when already installed (no network)", async () => {
  await writePkg({ next: "15.0.0", "@layoutdesign/context": "0.13.0" });
  const res = ensureDependency(tmp); // must NOT shell out to a package manager
  assert.equal(res.changed, false);
});

test("detectFramework reads package.json deps", async () => {
  await writePkg({ next: "14.0.0" });
  assert.equal(detectFramework(tmp), "next");
  await writePkg({ vite: "5.0.0" });
  assert.equal(detectFramework(tmp), "vite");
  await writePkg({ express: "4" });
  assert.equal(detectFramework(tmp), "unknown");
});

test("patches a Vite config, backs it up, and is idempotent", async () => {
  await writePkg({ vite: "5.0.0" });
  const cfg = path.join(tmp, "vite.config.ts");
  const original = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// keep my comment
export default defineConfig({
  plugins: [react()],
});
`;
  await fs.writeFile(cfg, original);

  await installLive(tmp);

  const patched = await fs.readFile(cfg, "utf8");
  assert.match(patched, /@layoutdesign\/context\/vite-plugin/);
  assert.match(patched, /layout\(\)/);
  // layout() must come before react().
  assert.ok(
    patched.indexOf("layout()") < patched.indexOf("react()"),
    "layout() ordered before react()"
  );
  assert.match(patched, /keep my comment/, "comments preserved by recast");

  const backup = await fs.readFile(`${cfg}.layout-backup`, "utf8");
  assert.equal(backup, original, "backup is the untouched original");

  // Idempotent: second run does not double-add.
  await installLive(tmp);
  const again = await fs.readFile(cfg, "utf8");
  assert.equal(
    again.match(/@layoutdesign\/context\/vite-plugin/g)?.length,
    1,
    "import added exactly once"
  );
});

test("wraps a Next config export with withLayout()", async () => {
  await writePkg({ next: "14.0.0" });
  const cfg = path.join(tmp, "next.config.mjs");
  await fs.writeFile(
    cfg,
    `const nextConfig = { reactStrictMode: true };\nexport default nextConfig;\n`
  );

  await installLive(tmp);

  const patched = await fs.readFile(cfg, "utf8");
  assert.match(patched, /@layoutdesign\/context\/next-plugin/);
  assert.match(patched, /withLayout\(nextConfig\)/);
});

test("creates .layout/live/ with config.json + .gitignore", async () => {
  await writePkg({ vite: "5.0.0" });
  await installLive(tmp);

  const cfg = JSON.parse(
    await fs.readFile(
      path.join(tmp, ".layout", "live", "config.json"),
      "utf8"
    )
  );
  assert.equal(cfg.snapToScale, true);
  assert.equal(cfg.complianceScoring.enabled, true);
  assert.equal(cfg.version, 1);

  const gi = await fs.readFile(
    path.join(tmp, ".layout", "live", ".gitignore"),
    "utf8"
  );
  assert.match(gi, /recent-edits\.\*/);
  assert.match(gi, /locks\.json/);
});

test("appends the CLAUDE.md managed block, idempotently", async () => {
  await writePkg({ vite: "5.0.0" });
  await fs.writeFile(
    path.join(tmp, "CLAUDE.md"),
    "# Project\n\nExisting content.\n"
  );

  await installLive(tmp);
  let md = await fs.readFile(path.join(tmp, "CLAUDE.md"), "utf8");
  assert.match(md, /# Project/, "existing content kept");
  assert.match(md, /<!-- BEGIN layout-live \(managed\) -->/);
  assert.match(md, /<!-- END layout-live \(managed\) -->/);
  assert.match(md, /get-recent-visual-edits/);

  await installLive(tmp);
  md = await fs.readFile(path.join(tmp, "CLAUDE.md"), "utf8");
  assert.equal(
    md.match(/<!-- BEGIN layout-live \(managed\) -->/g)?.length,
    1,
    "block present exactly once after re-run"
  );
});

test("creates CLAUDE.md when none exists", async () => {
  await writePkg({ vite: "5.0.0" });
  await installLive(tmp);
  const md = await fs.readFile(path.join(tmp, "CLAUDE.md"), "utf8");
  assert.match(md, /<!-- BEGIN layout-live \(managed\) -->/);
});

test("unusual config shape is left untouched (no throw, no backup churn)", async () => {
  await writePkg({ vite: "5.0.0" });
  const cfg = path.join(tmp, "vite.config.ts");
  // No plugins array at all — too unusual to edit safely.
  await fs.writeFile(cfg, `export default 42;\n`);
  await installLive(tmp);
  const after = await fs.readFile(cfg, "utf8");
  assert.equal(after, `export default 42;\n`, "left as-is");
});
