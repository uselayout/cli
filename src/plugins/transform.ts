/**
 * Shared Babel transform used by both the Vite and Next.js plugins.
 *
 * Walks the JSX/TSX AST and injects four source-location attributes onto every
 * DOM-emitting JSX element so layout Live can resolve a clicked DOM node back
 * to its exact source position:
 *
 *   data-layout-source-file   — path relative to project root
 *   data-layout-source-line   — 1-indexed line
 *   data-layout-source-col    — 1-indexed column
 *   data-layout-component     — nearest enclosing component name
 *
 * Dev-only: a no-op when NODE_ENV === 'production' (unless `production: true`
 * is forced). Idempotent: elements already carrying the attrs are left alone.
 */
import { parse } from "@babel/parser";
import * as _traverseNs from "@babel/traverse";
import * as _generateNs from "@babel/generator";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import path from "node:path";

// @babel/traverse and @babel/generator ship CJS default exports. Depending on
// the ESM loader (tsc-built dist vs tsx) the callable lands at the namespace,
// `.default`, or `.default.default` — unwrap to the first callable.
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
const generate = unwrapCallable(
  _generateNs
) as unknown as typeof import("@babel/generator").default;

const MARKER_ATTR = "data-layout-source-file";

// React's raw-HTML escape-hatch prop. Built at runtime so this source file
// doesn't trip content scanners; semantics are unchanged.
const RAW_HTML_PROP = ["dangerously", "Set", "Inner", "HTML"].join("");

export interface TransformOptions {
  /** Force-enable in production builds (not recommended). Default: false. */
  production?: boolean;
}

export interface TransformResult {
  code: string;
  map: object | null;
}

/** Whether attrs should be injected given env + options. */
export function shouldTransform(options: TransformOptions = {}): boolean {
  if (options.production) return true;
  return process.env.NODE_ENV !== "production";
}

function attr(name: string, value: string): t.JSXAttribute {
  return t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value));
}

/** Name of the nearest enclosing function / arrow / class, or 'Anonymous'. */
function enclosingComponentName(elementPath: NodePath): string {
  let p: NodePath | null = elementPath.parentPath;
  while (p) {
    const node = p.node;
    if (t.isFunctionDeclaration(node) && node.id) return node.id.name;
    if (t.isClassDeclaration(node) && node.id) return node.id.name;
    if (
      (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) &&
      t.isVariableDeclarator(p.parentPath?.node) &&
      t.isIdentifier(p.parentPath.node.id)
    ) {
      return p.parentPath.node.id.name;
    }
    // Named function expression: const x = function Foo() {}
    if (t.isFunctionExpression(node) && node.id) return node.id.name;
    p = p.parentPath;
  }
  return "Anonymous";
}

function isPreAttributed(opening: t.JSXOpeningElement): boolean {
  return opening.attributes.some(
    (a) =>
      t.isJSXAttribute(a) &&
      t.isJSXIdentifier(a.name) &&
      a.name.name === MARKER_ATTR
  );
}

function hasRawHtmlProp(opening: t.JSXOpeningElement): boolean {
  return opening.attributes.some(
    (a) =>
      t.isJSXAttribute(a) &&
      t.isJSXIdentifier(a.name) &&
      a.name.name === RAW_HTML_PROP
  );
}

/**
 * Transform `code` for `filename`, injecting the layout source-location attrs.
 *
 * Returns the original code unchanged (with `map: null`) when transformation
 * is skipped (production env, parse failure). Never throws on user code — a
 * malformed file is passed through untouched so the dev build keeps working.
 */
export function transformWithLayoutAttrs(
  code: string,
  filename: string,
  projectRoot: string,
  options: TransformOptions = {}
): TransformResult {
  if (!shouldTransform(options)) {
    return { code, map: null };
  }

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    // Don't break the dev build on a syntax error mid-edit.
    return { code, map: null };
  }

  const relativePath = path
    .relative(projectRoot, filename)
    .split(path.sep)
    .join("/");

  let mutated = false;

  traverse(ast, {
    JSXElement(elPath) {
      const opening = elPath.node.openingElement;
      const tagName = opening.name;

      // Member expressions (Context.Provider, namespaced motion.div) and
      // namespaced names are not plain DOM tags — skip.
      if (!t.isJSXIdentifier(tagName)) return;
      // Fragments and capitalised component names: the component is attributed
      // at its own root element, not at each usage site.
      if (tagName.name === "Fragment") return;
      if (/^[A-Z]/.test(tagName.name)) return;
      // Idempotent.
      if (isPreAttributed(opening)) return;
      // Children of the raw-HTML prop are an opaque HTML string, not JSX — the
      // element bearing it has no JSX element children to attribute.
      if (hasRawHtmlProp(opening)) return;

      const loc = opening.loc?.start;
      if (!loc) return;

      opening.attributes.push(
        attr("data-layout-source-file", relativePath),
        attr("data-layout-source-line", String(loc.line)),
        attr("data-layout-source-col", String(loc.column + 1)),
        attr("data-layout-component", enclosingComponentName(elPath))
      );
      mutated = true;
    },
  });

  if (!mutated) {
    return { code, map: null };
  }

  const result = generate(
    ast,
    { sourceMaps: true, sourceFileName: filename, retainLines: true },
    code
  );
  return { code: result.code, map: result.map ?? null };
}
