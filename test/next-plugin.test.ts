/**
 * Next.js plugin: dev-only webpack rule + clean composition with a user
 * webpack override.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Keep the dev-info hint file out of the repo for the webpack-composition tests
// below; the dedicated dev-info test re-enables it against a temp cwd.
process.env.LAYOUT_LIVE_NO_DEVINFO = "1";

import withLayout from "../src/plugins/next/index.js";

/** Write a fake node_modules/next@<version> into a temp project so the SWC
 *  ABI guard can resolve the host Next version. */
async function fakeNext(dir: string, version: string): Promise<void> {
  const nm = path.join(dir, "node_modules", "next");
  await fs.mkdir(nm, { recursive: true });
  await fs.writeFile(
    path.join(nm, "package.json"),
    JSON.stringify({ name: "next", version })
  );
}

function fakeWebpackCtx() {
  return {
    config: { module: { rules: [] as unknown[] } },
    options: {
      dev: true,
      defaultLoaders: { babel: { loader: "next-babel" } },
    },
  };
}

test("preserves existing next config keys", () => {
  const cfg = withLayout({ reactStrictMode: true, foo: "bar" });
  assert.equal(cfg.reactStrictMode, true);
  assert.equal(cfg.foo, "bar");
  assert.equal(typeof cfg.webpack, "function");
});

test("does NOT add the Babel rule on App Router (would break RSC)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-approuter-"));
  await fs.mkdir(path.join(dir, "app"), { recursive: true });
  const prevCwd = process.cwd();
  const prevDisable = process.env.LAYOUT_LIVE_NO_DEVINFO;
  process.chdir(dir);
  process.env.LAYOUT_LIVE_NO_DEVINFO = "1"; // don't write dev-info in this test
  try {
    const cfg = withLayout({});
    const out = cfg.webpack!({ module: { rules: [] } }, { dev: true });
    // No tagging rule injected → Next compiles RSC normally.
    assert.equal(out.module!.rules!.length, 0);
  } finally {
    process.chdir(prevCwd);
    if (prevDisable === undefined) delete process.env.LAYOUT_LIVE_NO_DEVINFO;
    else process.env.LAYOUT_LIVE_NO_DEVINFO = prevDisable;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("App Router + LAYOUT_LIVE_SWC=1 on a supported Next: injects swcPlugins, no Babel rule", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-swc-"));
  await fs.mkdir(path.join(dir, "app"), { recursive: true });
  await fakeNext(dir, "15.5.4"); // swc_core 35 → matches the shipped wasm
  const prevCwd = process.cwd();
  const prevSwc = process.env.LAYOUT_LIVE_SWC;
  process.chdir(dir);
  process.env.LAYOUT_LIVE_SWC = "1";
  process.env.LAYOUT_LIVE_NO_DEVINFO = "1";
  try {
    const cfg = withLayout({ reactStrictMode: true });
    // Top-level swcPlugins entry present, pointing at the prebuilt wasm.
    const plugins = cfg.experimental?.swcPlugins as Array<[string, unknown]>;
    assert.ok(Array.isArray(plugins), "experimental.swcPlugins is set");
    assert.equal(plugins.length, 1);
    assert.match(plugins[0]![0], /^@layoutdesign\/context\/swc-plugin\.wasm$/);
    assert.deepEqual(plugins[0]![1], {
      projectRoot: process.cwd(),
      dev: true,
    });
    // The webpack hook must still NOT add the Babel rule on App Router.
    const out = cfg.webpack!({ module: { rules: [] } }, { dev: true });
    assert.equal(out.module!.rules!.length, 0);
  } finally {
    process.chdir(prevCwd);
    if (prevSwc === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = prevSwc;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("App Router without opt-in: no swcPlugins (default-safe, no breakage)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-noswc-"));
  await fs.mkdir(path.join(dir, "app"), { recursive: true });
  const prevCwd = process.cwd();
  const prevSwc = process.env.LAYOUT_LIVE_SWC;
  process.chdir(dir);
  delete process.env.LAYOUT_LIVE_SWC;
  process.env.LAYOUT_LIVE_NO_DEVINFO = "1";
  try {
    const cfg = withLayout({});
    assert.equal(cfg.experimental, undefined);
  } finally {
    process.chdir(prevCwd);
    if (prevSwc !== undefined) process.env.LAYOUT_LIVE_SWC = prevSwc;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("guarded mode on an UNSUPPORTED Next: skips injection (no hard fail)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-swc-bad-"));
  await fs.mkdir(path.join(dir, "app"), { recursive: true });
  await fakeNext(dir, "16.2.7"); // swc_core 57 ≠ 35 → would break the build
  const prevCwd = process.cwd();
  const prevSwc = process.env.LAYOUT_LIVE_SWC;
  process.chdir(dir);
  process.env.LAYOUT_LIVE_SWC = "1";
  process.env.LAYOUT_LIVE_NO_DEVINFO = "1";
  try {
    const cfg = withLayout({});
    // The guard skips injection → Next never tries to load a mismatched wasm,
    // so the build can't break. (The skip REASON is unit-tested in
    // swc-plugin.test.ts; the user-facing warning text is cosmetic.)
    assert.equal(cfg.experimental, undefined);
    // Babel rule still not injected on App Router either.
    const out = cfg.webpack!({ module: { rules: [] } }, { dev: true });
    assert.equal(out.module!.rules!.length, 0);
  } finally {
    process.chdir(prevCwd);
    if (prevSwc === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = prevSwc;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("force mode on an unsupported Next: injects anyway (explicit risk)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-swc-force-"));
  await fs.mkdir(path.join(dir, "app"), { recursive: true });
  await fakeNext(dir, "16.2.7");
  const prevCwd = process.cwd();
  const prevSwc = process.env.LAYOUT_LIVE_SWC;
  process.chdir(dir);
  process.env.LAYOUT_LIVE_SWC = "force";
  process.env.LAYOUT_LIVE_NO_DEVINFO = "1";
  try {
    const cfg = withLayout({});
    const plugins = cfg.experimental?.swcPlugins as Array<[string, unknown]>;
    assert.ok(Array.isArray(plugins) && plugins.length === 1);
    assert.match(plugins[0]![0], /^@layoutdesign\/context\/swc-plugin\.wasm$/);
  } finally {
    process.chdir(prevCwd);
    if (prevSwc === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = prevSwc;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("SWC injection preserves a user's existing experimental.swcPlugins", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-swc-merge-"));
  await fs.mkdir(path.join(dir, "src", "app"), { recursive: true });
  await fakeNext(dir, "15.5.0");
  const prevCwd = process.cwd();
  const prevSwc = process.env.LAYOUT_LIVE_SWC;
  process.chdir(dir);
  process.env.LAYOUT_LIVE_SWC = "1";
  process.env.LAYOUT_LIVE_NO_DEVINFO = "1";
  try {
    const userPlugin: [string, unknown] = ["user-plugin.wasm", { a: 1 }];
    const cfg = withLayout({
      experimental: { swcPlugins: [userPlugin], serverActions: true },
    });
    const plugins = cfg.experimental?.swcPlugins as Array<[string, unknown]>;
    assert.equal(plugins.length, 2);
    assert.deepEqual(plugins[0], userPlugin); // user's first, ours appended
    assert.match(plugins[1]![0], /^@layoutdesign\/context\/swc-plugin\.wasm$/);
    // Other experimental keys preserved.
    assert.equal(cfg.experimental?.serverActions, true);
  } finally {
    process.chdir(prevCwd);
    if (prevSwc === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = prevSwc;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("adds a tsx/jsx rule in dev with babel-loader chained after next's", () => {
  const cfg = withLayout({});
  const { config, options } = fakeWebpackCtx();
  const out = cfg.webpack!(config, options);
  assert.equal(out.module!.rules!.length, 1);
  const rule = out.module!.rules![0] as {
    test: RegExp;
    exclude: RegExp;
    use: Array<{ loader: string }>;
  };
  assert.ok(rule.test.test("Component.tsx"));
  assert.ok(rule.test.test("Component.jsx"));
  assert.ok(rule.exclude.test("/node_modules/x"));
  // next's babel loader first, our wrapper second.
  assert.equal(rule.use.length, 2);
  assert.match(rule.use[1].loader, /babel-loader\.js$/);
});

test("does NOT add the rule in production builds", () => {
  const cfg = withLayout({});
  const config = { module: { rules: [] as unknown[] } };
  const out = cfg.webpack!(config, { dev: false });
  assert.equal(out.module!.rules!.length, 0);
});

test("warns ONCE (not silent) when Turbopack is detected", () => {
  const orig = console.warn;
  const seen: string[] = [];
  console.warn = (m?: unknown) => seen.push(String(m));
  const hadEnv = process.env.TURBOPACK;
  process.env.TURBOPACK = "1";
  try {
    withLayout({});
    withLayout({}); // idempotent — still only one warning
  } finally {
    console.warn = orig;
    if (hadEnv === undefined) delete process.env.TURBOPACK;
    else process.env.TURBOPACK = hadEnv;
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /Turbopack/);
});

test("writes .layout/live/dev-info.json on first dev compile", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-devinfo-"));
  const prevCwd = process.cwd();
  const prevDisable = process.env.LAYOUT_LIVE_NO_DEVINFO;
  const prevPort = process.env.PORT;
  process.chdir(dir);
  delete process.env.LAYOUT_LIVE_NO_DEVINFO;
  process.env.PORT = "3001";
  const cwdInside = process.cwd();
  try {
    const cfg = withLayout({});
    cfg.webpack!({ module: { rules: [] } }, { dev: true });
    const raw = await fs.readFile(
      path.join(dir, ".layout", "live", "dev-info.json"),
      "utf8"
    );
    const info = JSON.parse(raw) as {
      projectRoot: string;
      url: string;
      port: number;
    };
    assert.equal(info.port, 3001);
    assert.equal(info.url, "http://localhost:3001");
    assert.equal(info.projectRoot, cwdInside);
  } finally {
    process.chdir(prevCwd);
    if (prevDisable === undefined) delete process.env.LAYOUT_LIVE_NO_DEVINFO;
    else process.env.LAYOUT_LIVE_NO_DEVINFO = prevDisable;
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("composes with a user-supplied webpack override", () => {
  let userCalled = false;
  const cfg = withLayout({
    webpack(config: { module?: { rules?: unknown[] } }) {
      userCalled = true;
      (config.module!.rules as unknown[]).push({ marker: "user" });
      return config;
    },
  });
  const { config, options } = fakeWebpackCtx();
  const out = cfg.webpack!(config, options);
  assert.equal(userCalled, true, "user webpack() was invoked");
  // Our dev rule + the user's appended rule both present.
  assert.equal(out.module!.rules!.length, 2);
  assert.deepEqual(out.module!.rules![1], { marker: "user" });
});
