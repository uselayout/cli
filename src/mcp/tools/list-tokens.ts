import type { Kit } from "../../kit/types.js";
import { parseCssVariables } from "../../export/kit-tokens.js";

export const name = "list-tokens";

export const description =
  "Returns a flat, categorised inventory of the kit's design tokens as JSON: " +
  '[{ cssVar, value, category, mode }]. Categories are "color", "typography", "spacing", ' +
  '"radius", "shadow" or "other"; mode is "dark" for values declared under a dark-mode ' +
  'selector, otherwise "light". Use this when you need a structured token list (e.g. to ' +
  "render a token browser), rather than raw tokens.css/tokens.json file contents.";

// No inputs: the tool always lists every token in the active kit.
export const inputSchema = {};

export type TokenCategory =
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "other";

export interface ListedToken {
  /** CSS custom property name, including the leading `--`. */
  cssVar: string;
  value: string;
  category: TokenCategory;
  mode: "light" | "dark";
}

const COLOUR_VALUE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color)\(/i;
const DIMENSION_VALUE = /^-?\d*\.?\d+(?:px|rem|em|%)$/;

/**
 * Map a token path from tokens.json (W3C DTCG) to its `$type`, so tokens the
 * kit has typed metadata for are categorised exactly instead of heuristically.
 * `$type` inherits from group level per the DTCG spec.
 */
function dtcgTypeMap(tokensJson: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!tokensJson) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tokensJson);
  } catch {
    return map;
  }
  const walk = (
    node: Record<string, unknown>,
    path: string[],
    inherited?: string
  ): void => {
    const type = typeof node.$type === "string" ? node.$type : inherited;
    if (node.$value !== undefined) {
      if (type && path.length > 0) map.set(path.join("-").toLowerCase(), type);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (child !== null && typeof child === "object") {
        walk(child as Record<string, unknown>, [...path, key], type);
      }
    }
  };
  if (parsed && typeof parsed === "object") {
    walk(parsed as Record<string, unknown>, []);
  }
  return map;
}

/** Category from a DTCG `$type` (null → fall through to the heuristics). */
function categoryFromDtcgType(
  type: string,
  name: string
): TokenCategory | null {
  switch (type) {
    case "color":
      return "color";
    case "fontFamily":
    case "fontWeight":
    case "fontSize":
    case "lineHeight":
    case "letterSpacing":
    case "typography":
      return "typography";
    case "shadow":
      return "shadow";
    case "dimension":
    case "number":
      if (/radius|rounded/.test(name)) return "radius";
      if (/shadow|elevation/.test(name)) return "shadow";
      return "spacing";
    default:
      return null;
  }
}

/** Name/value heuristics for tokens without DTCG metadata. Name checks run
 *  before the colour-value check because shadow values embed colours
 *  (`--shadow-sm: 0 1px 2px rgba(...)` must stay a shadow, not a colour). */
function inferCategory(name: string, value: string): TokenCategory {
  const n = name.toLowerCase();
  const v = value.trim();
  if (/font|typography|leading|tracking|letter-spacing|line-height/.test(n)) {
    return "typography";
  }
  if (/radius|rounded/.test(n)) return "radius";
  if (/shadow|elevation/.test(n)) return "shadow";
  if (/space|spacing|gap|padding|margin|inset/.test(n)) return "spacing";
  if (COLOUR_VALUE.test(v)) return "color";
  if (/color|bg|background|text|border|surface|accent|fill|stroke/.test(n)) {
    // A bare dimension named text-*/border-* is a size (font-size,
    // border-width), not a colour reference.
    if (DIMENSION_VALUE.test(v)) return /text/.test(n) ? "typography" : "other";
    return "color";
  }
  return "other";
}

export function handler(kit: Kit | null) {
  return async () => {
    if (!kit) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No design system kit found. Run `npx @layoutdesign/context init` to set one up.",
          },
        ],
      };
    }

    if (!kit.tokensCss) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify([]) }],
      };
    }

    const dtcgTypes = dtcgTypeMap(kit.tokensJson);
    const tokens: ListedToken[] = parseCssVariables(kit.tokensCss).map((v) => {
      const lower = v.name.toLowerCase();
      const typed = dtcgTypes.get(lower);
      const category =
        (typed ? categoryFromDtcgType(typed, lower) : null) ??
        inferCategory(v.name, v.value);
      return {
        cssVar: `--${v.name}`,
        value: v.value,
        category,
        mode: v.mode === "dark" ? "dark" : "light",
      };
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(tokens, null, 2) }],
    };
  };
}
