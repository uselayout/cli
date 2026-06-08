/**
 * Parity oracle: the Rust/Wasm SWC plugin (assets/layout-swc-plugin.wasm) must
 * tag the SAME elements with the SAME four attribute values as the Babel
 * `transform.ts`. Output *formatting* differs (Babel emits JSX, SWC lowers to
 * React.createElement), so parity is asserted on the SET of tagged elements:
 * {tag, file, line, col, component}, sorted by (line, col, tag).
 *
 * This also doubles as the ABI check: if the prebuilt .wasm can't be loaded by
 * the installed @swc/core, `transform` throws here and the suite fails loudly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform as swcTransform } from "@swc/core";
import { parse } from "@babel/parser";
import * as _traverseNs from "@babel/traverse";
import * as t from "@babel/types";
import { transformWithLayoutAttrs } from "../src/plugins/transform.js";

function unwrapCallable(ns: unknown): (...args: never[]) => unknown {
  let cur: unknown = ns;
  for (let i = 0; i < 3; i++) {
    if (typeof cur === "function") return cur as (...a: never[]) => unknown;
    cur = (cur as { default?: unknown } | null)?.default;
  }
  throw new Error("Could not resolve a callable Babel export");
}
const traverse = unwrapCallable(
  _traverseNs
) as unknown as typeof import("@babel/traverse").default;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = "/project";
const FILE = "/project/src/Hero.tsx";
const WASM = path.resolve(HERE, "..", "assets", "layout-swc-plugin.wasm");

interface Tag {
  tag: string;
  file: string;
  line: string;
  col: string;
  component: string;
}

const ATTRS = [
  "data-layout-source-file",
  "data-layout-source-line",
  "data-layout-source-col",
  "data-layout-component",
] as const;

function sortTags(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) =>
    a.line !== b.line
      ? Number(a.line) - Number(b.line)
      : a.col !== b.col
        ? Number(a.col) - Number(b.col)
        : a.tag.localeCompare(b.tag)
  );
}

/** Tagged elements from the Babel oracle output (JSX still present). */
function oracleTags(code: string): Tag[] {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  const out: Tag[] = [];
  traverse(ast, {
    JSXOpeningElement(p) {
      const get = (name: string): string | null => {
        for (const a of p.node.attributes) {
          if (
            t.isJSXAttribute(a) &&
            t.isJSXIdentifier(a.name) &&
            a.name.name === name &&
            t.isStringLiteral(a.value)
          ) {
            return a.value.value;
          }
        }
        return null;
      };
      const file = get(ATTRS[0]);
      if (file == null) return; // untagged
      const name = p.node.name;
      const tag = t.isJSXIdentifier(name) ? name.name : "<expr>";
      out.push({
        tag,
        file,
        line: get(ATTRS[1]) ?? "",
        col: get(ATTRS[2]) ?? "",
        component: get(ATTRS[3]) ?? "",
      });
    },
  });
  return out;
}

/** Tagged elements from the SWC output (React.createElement(type, props,…)). */
function swcTags(code: string): Tag[] {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  const out: Tag[] = [];
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      const isCreate =
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "React" }) &&
        t.isIdentifier(callee.property, { name: "createElement" });
      if (!isCreate) return;
      const [typeArg, propsArg] = p.node.arguments;
      if (!t.isObjectExpression(propsArg)) return;
      const props = new Map<string, string>();
      for (const pr of propsArg.properties) {
        if (
          t.isObjectProperty(pr) &&
          !pr.computed &&
          t.isStringLiteral(pr.value)
        ) {
          const key = t.isStringLiteral(pr.key)
            ? pr.key.value
            : t.isIdentifier(pr.key)
              ? pr.key.name
              : null;
          if (key) props.set(key, pr.value.value);
        }
      }
      const file = props.get(ATTRS[0]);
      if (file == null) return; // untagged element
      const tag = t.isStringLiteral(typeArg)
        ? typeArg.value
        : t.isIdentifier(typeArg)
          ? typeArg.name
          : "<expr>";
      out.push({
        tag,
        file,
        line: props.get(ATTRS[1]) ?? "",
        col: props.get(ATTRS[2]) ?? "",
        component: props.get(ATTRS[3]) ?? "",
      });
    },
  });
  return out;
}

async function runSwc(code: string): Promise<string> {
  const out = await swcTransform(code, {
    filename: FILE,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "classic" } },
      experimental: { plugins: [[WASM, { projectRoot: ROOT, dev: true }]] },
    },
  });
  return out.code;
}

function oracle(code: string): Tag[] {
  return sortTags(
    oracleTags(transformWithLayoutAttrs(code, FILE, ROOT, { production: true }).code)
  );
}

// Each fixture asserts the wasm plugin produces the identical tagged-element
// set as the Babel oracle. Mirrors test/transform.test.ts case-for-case.
const FIXTURES: Array<{ name: string; code: string }> = [
  {
    name: "two nested DOM elements, all four attrs",
    code: `export function Hero() { return <div><span>hi</span></div>; }`,
  },
  {
    name: "arrow-function component name",
    code: `const Card = () => <div>x</div>;`,
  },
  {
    name: "anonymous component → Anonymous",
    code: `export default () => <div>x</div>;`,
  },
  {
    name: "named Fragment is skipped, child tagged",
    code: `function A(){ return <Fragment><div>a</div></Fragment>; }`,
  },
  {
    name: "shorthand fragment skipped, only <p> tagged",
    code: `function B(){ return <><p>b</p></>; }`,
  },
  {
    name: "capitalised component skipped, host child tagged",
    code: `function App(){ return <Layout><div>x</div></Layout>; }`,
  },
  {
    name: "capitalised component WITH static className is tagged",
    code: `function App(){ return <Pill className="p-4 bg-blue-500">x</Pill>; }`,
  },
  {
    name: "capitalised component with dynamic className NOT tagged",
    code: `function App({c}){ return <Pill className={cn('p-4', c)}>x</Pill>; }`,
  },
  {
    name: "capitalised component with no className NOT tagged",
    code: `function App(){ return <Pill>x</Pill>; }`,
  },
  {
    name: "member-expression element skipped (Context.Provider)",
    code: `function P({c}){ return <c.Provider value={1}><div>x</div></c.Provider>; }`,
  },
  {
    name: "raw-HTML escape-hatch element skipped",
    code: `function R(){ return <div ${["dangerously", "Set", "Inner", "HTML"].join("")}={{__html:'x'}} />; }`,
  },
  {
    name: "template-literal className with no expressions is static",
    code: "function App(){ return <Pill className={`p-4`}>x</Pill>; }",
  },
  {
    name: "named function expression assigned to a var → var name wins",
    code: `const X = function Foo(){ return <div>x</div>; };`,
  },
  {
    name: "multi-line: line numbers per element",
    code: `export function Page() {\n  return (\n    <main>\n      <h1>Title</h1>\n    </main>\n  );\n}`,
  },
  {
    name: "nested components: inner arrow name wins",
    code: `function Outer(){ const Inner = () => <div>x</div>; return <Inner/>; }`,
  },
];

for (const fx of FIXTURES) {
  test(`parity: ${fx.name}`, async () => {
    const expected = oracle(fx.code);
    const actual = sortTags(swcTags(await runSwc(fx.code)));
    assert.deepEqual(
      actual,
      expected,
      `\nwasm:   ${JSON.stringify(actual)}\noracle: ${JSON.stringify(expected)}`
    );
  });
}

test("idempotent: re-running over already-tagged source adds nothing", async () => {
  // The oracle output is JSX with attrs; feed it back through the wasm and the
  // count of data-layout-source-file must not grow.
  const once = transformWithLayoutAttrs(
    `function H(){ return <div>x</div>; }`,
    FILE,
    ROOT,
    { production: true }
  ).code;
  const twice = await runSwc(once);
  const n = (twice.match(/data-layout-source-file/g) ?? []).length;
  assert.equal(n, 1, "no duplicate tagging on a pre-attributed element");
});
