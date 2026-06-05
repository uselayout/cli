/**
 * live preflight: detect missing source tags before opening, and (with
 * consent) auto-wire the dev plugin + drop --turbopack, else stay hands-off.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { preflightSourceTags } from "../src/cli/live-preflight.js";

let dir = "";
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = "";
});

async function nextProject(devScript: string): Promise<string> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-"));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "x", dependencies: { next: "15.0.0" }, scripts: { dev: devScript } },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(dir, "next.config.ts"),
    "export default { reactStrictMode: true };\n"
  );
  return dir;
}

const yes = { interactive: true, confirm: async () => true } as const;

test("served HTML already has tags → no changes", async () => {
  const root = await nextProject("next dev --turbopack");
  const res = await preflightSourceTags(root, "http://localhost:3001", {
    probeTags: async () => true,
    ...yes,
  });
  assert.equal(res.hadTags, true);
  assert.equal(res.wiredPlugin, false);
  assert.equal(res.fixedTurbopack, false);
  const cfg = await fs.readFile(path.join(root, "next.config.ts"), "utf8");
  assert.ok(!cfg.includes("withLayout"), "config left untouched");
});

test("Next, unwired + turbopack: wires plugin and drops --turbopack", async () => {
  const root = await nextProject("next dev --turbopack");
  const res = await preflightSourceTags(root, "http://localhost:3001", {
    probeTags: async () => false,
    ...yes,
  });
  assert.equal(res.hadTags, false);
  assert.equal(res.wiredPlugin, true);
  assert.equal(res.fixedTurbopack, true);
  assert.equal(res.needsRestart, true);

  const cfg = await fs.readFile(path.join(root, "next.config.ts"), "utf8");
  assert.ok(cfg.includes("withLayout"), "next.config wrapped with withLayout");
  assert.ok(cfg.includes("@layoutdesign/context/next-plugin"));

  const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8")
  ) as { scripts: { dev: string } };
  assert.equal(pkg.scripts.dev, "next dev", "--turbopack removed");
});

test("non-interactive run never edits files", async () => {
  const root = await nextProject("next dev --turbopack");
  const res = await preflightSourceTags(root, "http://localhost:3001", {
    probeTags: async () => false,
    interactive: false,
  });
  assert.equal(res.wiredPlugin, false);
  assert.equal(res.fixedTurbopack, false);
  const cfg = await fs.readFile(path.join(root, "next.config.ts"), "utf8");
  assert.ok(!cfg.includes("withLayout"), "config untouched without consent");
});

test("Vite already wired → treated ready despite empty served shell", async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "preflight-vite-"));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", devDependencies: { vite: "5.0.0" } })
  );
  await fs.writeFile(
    path.join(dir, "vite.config.ts"),
    `import layout from "@layoutdesign/context/vite-plugin";\n` +
      `export default { plugins: [layout()] };\n`
  );
  const res = await preflightSourceTags(dir, "http://localhost:5173", {
    probeTags: async () => false, // SPA shell has no tags in raw HTML
    ...yes,
  });
  assert.equal(res.hadTags, true, "wired Vite is treated ready");
  assert.equal(res.wiredPlugin, false);
});
