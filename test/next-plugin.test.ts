/**
 * Next.js plugin: dev-only webpack rule + clean composition with a user
 * webpack override.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import withLayout from "../src/plugins/next/index.js";

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
