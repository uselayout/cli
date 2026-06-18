/**
 * classifyLiveEditing + devScriptUsesTurbopack: the static "can this project be
 * edited in Layout Live?" verdict shared by `doctor`, `install`, and the
 * `check-setup` MCP tool. Pure (config + package.json only), no network.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyLiveEditing,
  devScriptUsesTurbopack,
} from "../src/install/live.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layout-classify-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function pkg(obj: Record<string, unknown>) {
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "fix", ...obj }, null, 2)
  );
}

async function config(base: "vite" | "next", body: string) {
  await fs.writeFile(path.join(tmp, `${base}.config.ts`), body);
}

const WIRED_VITE = `import layout from "@layoutdesign/context/vite-plugin";\nexport default { plugins: [layout()] };\n`;
const WIRED_NEXT = `import withLayout from "@layoutdesign/context/next-plugin";\nexport default withLayout({});\n`;

test("devScriptUsesTurbopack recognises the turbo flags only with Next", async () => {
  await pkg({ scripts: { dev: "next dev --turbopack" } });
  assert.equal(devScriptUsesTurbopack(tmp), true);
  await pkg({ scripts: { dev: "next dev --turbo" } });
  assert.equal(devScriptUsesTurbopack(tmp), true);
  await pkg({ scripts: { dev: "next dev" } });
  assert.equal(devScriptUsesTurbopack(tmp), false);
  await pkg({ scripts: { dev: "vite --turbo" } });
  assert.equal(devScriptUsesTurbopack(tmp), false); // not Next
  await pkg({});
  assert.equal(devScriptUsesTurbopack(tmp), false); // no dev script
});

test("n/a for a non-Vite/Next project", async () => {
  await pkg({ dependencies: { express: "4" } });
  assert.equal(classifyLiveEditing(tmp).state, "n/a");
});

test("not-wired when the build plugin is absent from the config", async () => {
  await pkg({ dependencies: { vite: "5" } });
  const c = classifyLiveEditing(tmp);
  assert.equal(c.state, "not-wired");
  assert.equal(c.framework, "vite");
});

test("dep-missing when wired but @layoutdesign/context isn't installed", async () => {
  await pkg({ dependencies: { vite: "5" } });
  await config("vite", WIRED_VITE);
  assert.equal(classifyLiveEditing(tmp).state, "dep-missing");
});

test("ready for a wired Vite project with the dep present", async () => {
  await pkg({
    dependencies: { vite: "5" },
    devDependencies: { "@layoutdesign/context": "0.14.0" },
  });
  await config("vite", WIRED_VITE);
  const c = classifyLiveEditing(tmp);
  assert.equal(c.state, "ready");
  assert.equal(c.framework, "vite");
});

test("turbopack when a wired Next project's dev script bypasses tagging", async () => {
  await pkg({
    dependencies: { next: "15.3.0" }, // no node_modules/next → SWC tagging not ready
    devDependencies: { "@layoutdesign/context": "0.14.0" },
    scripts: { dev: "next dev --turbopack" },
  });
  await config("next", WIRED_NEXT);
  const c = classifyLiveEditing(tmp);
  assert.equal(c.state, "turbopack");
  assert.equal(c.swcReady, false);
});

test("ready for a wired Next Pages Router project on plain `next dev`", async () => {
  await pkg({
    dependencies: { next: "15.3.0" },
    devDependencies: { "@layoutdesign/context": "0.14.0" },
    scripts: { dev: "next dev" },
  });
  await config("next", WIRED_NEXT);
  assert.equal(classifyLiveEditing(tmp).state, "ready");
});

test("unsupported for a wired Next App Router project with no working tagging path", async () => {
  await pkg({
    dependencies: { next: "14.2.35" }, // App Router + no shipped SWC ABI → no tags
    devDependencies: { "@layoutdesign/context": "0.14.0" },
    scripts: { dev: "next dev" },
  });
  await config("next", WIRED_NEXT);
  await fs.mkdir(path.join(tmp, "app"), { recursive: true });
  const c = classifyLiveEditing(tmp);
  assert.equal(c.state, "unsupported");
  assert.equal(c.swcReady, false);
});

test("App Router unsupported takes precedence over the turbopack hint", async () => {
  await pkg({
    dependencies: { next: "14.2.35" },
    devDependencies: { "@layoutdesign/context": "0.14.0" },
    scripts: { dev: "next dev --turbopack" },
  });
  await config("next", WIRED_NEXT);
  await fs.mkdir(path.join(tmp, "app"), { recursive: true });
  // Dropping Turbopack wouldn't help App Router, so don't suggest it.
  assert.equal(classifyLiveEditing(tmp).state, "unsupported");
});
