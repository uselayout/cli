/**
 * Vite plugin: shape contract + transform gating.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import layout from "../src/plugins/vite/index.js";

test("plugin has the spec'd name/enforce/apply", () => {
  const p = layout();
  assert.equal(p.name, "@layoutdesign/context/vite-plugin");
  assert.equal(p.enforce, "pre");
  assert.equal(p.apply, "serve");
});

test("transform ignores non-jsx/tsx ids", () => {
  const p = layout({ production: true });
  assert.equal(p.transform("export const x=1", "/p/foo.ts"), null);
  assert.equal(p.transform("body{}", "/p/styles.css"), null);
});

test("transform ignores node_modules", () => {
  const p = layout({ production: true });
  assert.equal(
    p.transform(
      "function H(){return <div/>}",
      "/p/node_modules/x/index.tsx"
    ),
    null
  );
});

test("transform injects attrs on a real tsx module (root from configResolved)", () => {
  const p = layout({ production: true });
  p.configResolved({ root: "/proj" });
  const out = p.transform(
    `export function Hero(){ return <div>x</div>; }`,
    "/proj/src/Hero.tsx"
  );
  assert.ok(out, "returned a result");
  assert.match(out!.code, /data-layout-source-file="src\/Hero\.tsx"/);
  assert.ok(out!.map, "source map preserved");
});

test("transform returns null when there is nothing to inject", () => {
  const p = layout({ production: true });
  assert.equal(
    p.transform("export const n = 1;", "/proj/src/util.tsx"),
    null
  );
});

test("respects include / exclude filters", () => {
  const excluded = layout({ production: true, exclude: ["legacy"] });
  assert.equal(
    excluded.transform("function H(){return <div/>}", "/p/src/legacy/A.tsx"),
    null
  );
  const included = layout({ production: true, include: ["src/"] });
  assert.equal(
    included.transform("function H(){return <div/>}", "/p/other/A.tsx"),
    null
  );
});

test("dev-only: no transform under NODE_ENV=production without force", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const p = layout();
    assert.equal(
      p.transform("function H(){return <div/>}", "/proj/src/A.tsx"),
      null
    );
  } finally {
    process.env.NODE_ENV = prev;
  }
});
