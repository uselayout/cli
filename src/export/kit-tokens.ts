/**
 * Derive flat, categorised token lists from a loaded kit.
 *
 * Two sources, in preference order:
 *   1. tokens.json (W3C DTCG) — carries $type, so categorisation is exact.
 *   2. tokens.css — custom properties, categorised by name/value heuristics.
 *
 * The output shape mirrors Studio's ExtractedTokens so the design.md emitter
 * (a 1:1 port of Studio's) receives identical input structure.
 */
import type { Kit } from "../kit/types.js";
import type { DesignMdToken, DesignMdTokens } from "./design-md.js";

export interface CssVariable {
  /** Custom property name WITHOUT the leading `--`. */
  name: string;
  value: string;
  /** "dark" when declared under a dark-mode selector; undefined for :root. */
  mode?: string;
}

/**
 * Parse custom properties out of a flat token stylesheet (:root plus optional
 * `[data-theme="dark"]` / `.dark` blocks). Deliberately simple: kit token
 * files are generated, flat CSS without nested at-rules.
 */
export function parseCssVariables(css: string): CssVariable[] {
  const vars: CssVariable[] = [];
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css)) !== null) {
    const selector = (block[1] ?? "").trim();
    const body = block[2] ?? "";
    const mode =
      /data-theme=['"]?dark['"]?|\.dark\b/.test(selector) ? "dark" : undefined;
    const declRe = /--([\w-]+)\s*:\s*([^;]+);/g;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(body)) !== null) {
      const name = decl[1];
      const value = decl[2];
      if (!name || !value) continue;
      vars.push({ name, value: value.trim(), mode });
    }
  }
  return vars;
}

function emptyTokens(): DesignMdTokens {
  return { colors: [], typography: [], spacing: [], radius: [], effects: [] };
}

type Category = keyof DesignMdTokens;

interface DtcgNode {
  $type?: string;
  $value?: unknown;
  $extensions?: { mode?: string; [key: string]: unknown };
  [key: string]: unknown;
}

function stringifyDtcgValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(stringifyDtcgValue).join(", ");
  return JSON.stringify(value);
}

function categoriseDtcg(type: string | undefined, path: string[]): Category | null {
  const root = (path[0] ?? "").toLowerCase();
  switch (type) {
    case "color":
      return "colors";
    case "fontFamily":
    case "fontWeight":
    case "fontSize":
    case "lineHeight":
    case "typography":
      return "typography";
    case "shadow":
      return "effects";
    case "dimension":
    case "number": {
      if (/radius|rounded/.test(root)) return "radius";
      if (/shadow|elevation|effect/.test(root)) return "effects";
      return "spacing";
    }
    default:
      // Untyped or unmodelled ($type duration, cubicBezier, ...): skip.
      return null;
  }
}

function walkDtcg(
  node: DtcgNode,
  path: string[],
  out: DesignMdTokens
): void {
  if (node.$value !== undefined) {
    const category = categoriseDtcg(node.$type, path);
    if (category) {
      const token: DesignMdToken = {
        name: path.join("-"),
        value: stringifyDtcgValue(node.$value),
      };
      const mode = node.$extensions?.mode;
      if (typeof mode === "string" && mode.length > 0) token.mode = mode;
      out[category].push(token);
    }
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    if (child !== null && typeof child === "object") {
      walkDtcg(child as DtcgNode, [...path, key], out);
    }
  }
}

const COLOUR_VALUE = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|color)\(/i;

function categoriseCssVariable(v: CssVariable): Category | null {
  const name = v.name.toLowerCase();
  if (/font|leading|tracking|letter-spacing|line-height/.test(name)) {
    return "typography";
  }
  if (/space|spacing|gap|inset/.test(name)) return "spacing";
  if (/radius|rounded/.test(name)) return "radius";
  if (/shadow|elevation/.test(name)) return "effects";
  if (COLOUR_VALUE.test(v.value)) return "colors";
  return null;
}

/**
 * Categorised tokens for a kit — DTCG tokens.json first, tokens.css fallback.
 * Returns undefined when the kit ships neither.
 */
export function kitDesignTokens(kit: Kit): DesignMdTokens | undefined {
  if (kit.tokensJson) {
    try {
      const parsed = JSON.parse(kit.tokensJson) as DtcgNode;
      const out = emptyTokens();
      walkDtcg(parsed, [], out);
      if (Object.values(out).some((list) => list.length > 0)) return out;
    } catch {
      // Malformed tokens.json — fall through to the CSS heuristics.
    }
  }

  if (kit.tokensCss) {
    const out = emptyTokens();
    for (const v of parseCssVariables(kit.tokensCss)) {
      const category = categoriseCssVariable(v);
      if (!category) continue;
      const token: DesignMdToken = { name: v.name, value: v.value };
      if (v.mode) token.mode = v.mode;
      out[category].push(token);
    }
    if (Object.values(out).some((list) => list.length > 0)) return out;
  }

  return undefined;
}
