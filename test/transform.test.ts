/**
 * Shared Babel transform: attr injection, skip rules, idempotency,
 * source-map preservation, dev-only gating.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transformWithLayoutAttrs,
  shouldTransform,
} from "../src/plugins/transform.js";

const ROOT = "/project";
const FILE = "/project/src/Hero.tsx";

function run(code: string) {
  return transformWithLayoutAttrs(code, FILE, ROOT, { production: true });
}

test("injects all four attrs on DOM elements with relative file path", () => {
  const { code } = run(
    `export function Hero() { return <div><span>hi</span></div>; }`
  );
  assert.match(code, /data-layout-source-file="src\/Hero\.tsx"/);
  assert.match(code, /data-layout-source-line="1"/);
  assert.match(code, /data-layout-source-col="\d+"/);
  assert.match(code, /data-layout-component="Hero"/);
  // Two DOM elements → two injected file attrs.
  assert.equal(code.match(/data-layout-source-file=/g)?.length, 2);
});

test("detects arrow-function component name", () => {
  const { code } = run(`const Card = () => <div>x</div>;`);
  assert.match(code, /data-layout-component="Card"/);
});

test("anonymous component falls back to 'Anonymous'", () => {
  const { code } = run(`export default () => <div>x</div>;`);
  assert.match(code, /data-layout-component="Anonymous"/);
});

test("skips React Fragment (named and shorthand)", () => {
  const named = run(
    `function A(){ return <Fragment><div>a</div></Fragment>; }`
  ).code;
  assert.doesNotMatch(named, /<Fragment data-layout/);
  assert.match(named, /<div data-layout-source-file/);

  const shorthand = run(`function B(){ return <><p>b</p></>; }`).code;
  // Shorthand fragment has no opening identifier — only <p> gets attrs.
  assert.equal(
    shorthand.match(/data-layout-source-file=/g)?.length,
    1
  );
});

test("skips capitalised component elements", () => {
  const { code } = run(
    `function App(){ return <Layout><div>x</div></Layout>; }`
  );
  assert.doesNotMatch(code, /<Layout data-layout/);
  assert.match(code, /<div data-layout-source-file/);
});

test("tags a capitalised component that has a static className prop", () => {
  const { code } = run(
    `function App(){ return <Pill className="p-4 bg-blue-500">x</Pill>; }`
  );
  assert.match(code, /<Pill className="p-4 bg-blue-500" data-layout-source-file/);
});

test("does NOT tag a capitalised component with a dynamic className", () => {
  const cn = run(
    `function App({c}){ return <Pill className={cn('p-4', c)}>x</Pill>; }`
  ).code;
  assert.doesNotMatch(cn, /<Pill[^>]*data-layout-source-file/);
  const none = run(`function App(){ return <Pill>x</Pill>; }`).code;
  assert.doesNotMatch(none, /<Pill[^>]*data-layout-source-file/);
});

test("skips member-expression elements (Context.Provider)", () => {
  const { code } = run(
    `function P({c}){ return <c.Provider value={1}><div>x</div></c.Provider>; }`
  );
  assert.doesNotMatch(code, /Provider data-layout/);
  assert.match(code, /<div data-layout-source-file/);
});

test("tags a member-expression element with a static className (framer-motion)", () => {
  const { code } = run(
    `function App(){ return <motion.h1 className="text-6xl">Hi</motion.h1>; }`
  );
  assert.match(code, /motion\.h1[^>]*data-layout-source-file/);
  // …but a member-expression with no static className stays untagged.
  const none = run(`function App(){ return <motion.h1>Hi</motion.h1>; }`).code;
  assert.doesNotMatch(none, /motion\.h1[^>]*data-layout-source-file/);
});

test("skips elements bearing the raw-HTML escape-hatch prop", () => {
  const prop = ["dangerously", "Set", "Inner", "HTML"].join("");
  const { code } = run(
    `function R(){ return <div ${prop}={{__html:'x'}} />; }`
  );
  assert.doesNotMatch(code, /data-layout-source-file/);
});

test("is idempotent — pre-attributed elements are left alone", () => {
  const first = run(`function H(){ return <div>x</div>; }`).code;
  const second = run(first).code;
  assert.equal(first, second);
  assert.equal(second.match(/data-layout-source-file=/g)?.length, 1);
});

test("produces a source map when it mutates", () => {
  const result = run(`function H(){ return <div>x</div>; }`);
  assert.ok(result.map, "map present");
  assert.ok(
    (result.map as { mappings?: string }).mappings,
    "map has mappings"
  );
});

test("returns input unchanged with map:null when nothing to inject", () => {
  const code = `export const x = 1;`;
  const result = run(code);
  assert.equal(result.code, code);
  assert.equal(result.map, null);
});

test("dev-only: no-op when NODE_ENV=production and not forced", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(shouldTransform(), false);
    assert.equal(shouldTransform({ production: true }), true);
    const code = `function H(){ return <div>x</div>; }`;
    const out = transformWithLayoutAttrs(code, FILE, ROOT);
    assert.equal(out.code, code, "production build untouched");
    assert.equal(out.map, null);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("malformed input is passed through, never throws", () => {
  const broken = `function H(){ return <div>;`;
  const out = run(broken);
  assert.equal(out.code, broken);
  assert.equal(out.map, null);
});
