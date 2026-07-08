/**
 * Nearest-token suggestion engine for compliance issues.
 *
 * Given an offending literal (a hardcoded colour or an off-scale px value)
 * and the active kit, find the design-system token that is close enough to
 * be a confident one-click replacement. Colours use the redmean
 * weighted-RGB distance; spacing uses relative distance on the px scale.
 * Genuinely novel values (nothing within threshold) get NO suggestion.
 */
import type { Kit } from "../kit/types.js";
import type { ComplianceIssue } from "./checker.js";
import { parseCssVariables } from "../export/kit-tokens.js";

export interface TokenSuggestion {
  /** CSS custom property name, with the leading `--`. */
  token: string;
  /** The token's value, as declared in the kit's tokens.css. */
  value: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a CSS colour literal to RGB. Supports #rgb/#rgba/#rrggbb/#rrggbbaa,
 * rgb()/rgba() and hsl()/hsla(). Returns null for anything else (var() refs,
 * named colours, oklch, gradients), those are never suggestion candidates.
 */
export function parseColour(input: string): Rgb | null {
  const v = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/.exec(v);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    if (r > 255 || g > 255 || b > 255) return null;
    return { r, g, b };
  }

  const hsl =
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/.exec(
      v,
    );
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  }

  return null;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Redmean colour distance: a cheap perceptual weighting of RGB distance.
 * Range is 0 (identical) to ~765 (black vs white).
 */
export function colourDistance(a: Rgb, b: Rgb): number {
  const rMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rMean) / 256) * db * db,
  );
}

/** Max redmean distance for a suggestion, beyond this the colour is treated
 *  as genuinely novel (~13% of the black-to-white distance). */
export const COLOUR_DISTANCE_THRESHOLD = 100;

/** Max relative deviation for a spacing suggestion (13px → 12px is 7.7%). */
export const SPACING_TOLERANCE = 0.25;

/** The kit's colour tokens (base mode) that parse as concrete colours. */
function kitColourTokens(kit: Kit): Array<{ name: string; value: string }> {
  if (!kit.tokensCss) return [];
  return parseCssVariables(kit.tokensCss)
    .filter((v) => !v.mode && parseColour(v.value) !== null)
    .map((v) => ({ name: v.name, value: v.value }));
}

/** The kit's spacing-scale tokens (base mode) with a resolvable px value. */
function kitSpacingTokens(
  kit: Kit,
): Array<{ name: string; px: number; value: string }> {
  if (!kit.tokensCss) return [];
  const out: Array<{ name: string; px: number; value: string }> = [];
  for (const v of parseCssVariables(kit.tokensCss)) {
    if (v.mode) continue;
    if (!/space|spacing|gap/i.test(v.name)) continue;
    const px = toPx(v.value);
    if (px !== null && px > 0) out.push({ name: v.name, px, value: v.value });
  }
  return out;
}

/** "16px" → 16, "1rem" → 16, anything else → null. */
function toPx(value: string): number | null {
  const m = /^\s*(-?[\d.]+)\s*(px|rem)\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2]!.toLowerCase() === "rem" ? n * 16 : n;
}

/**
 * Nearest colour token to `value` by redmean distance, or null when the
 * closest token is still beyond COLOUR_DISTANCE_THRESHOLD (novel colour).
 */
export function nearestColourToken(
  value: string,
  tokens: Array<{ name: string; value: string }>,
): TokenSuggestion | null {
  const target = parseColour(value);
  if (!target) return null;
  let best: { token: TokenSuggestion; distance: number } | null = null;
  for (const t of tokens) {
    const rgb = parseColour(t.value);
    if (!rgb) continue;
    const distance = colourDistance(target, rgb);
    if (!best || distance < best.distance) {
      best = { token: { token: `--${t.name}`, value: t.value }, distance };
    }
  }
  if (!best || best.distance > COLOUR_DISTANCE_THRESHOLD) return null;
  return best.token;
}

/**
 * Nearest spacing token to a px literal ("13px"), or null when the closest
 * token deviates more than SPACING_TOLERANCE from the target.
 */
export function nearestSpacingToken(
  value: string,
  tokens: Array<{ name: string; px: number; value: string }>,
): TokenSuggestion | null {
  const target = toPx(value);
  if (target === null || target <= 0) return null;
  let best: { token: TokenSuggestion; diff: number } | null = null;
  for (const t of tokens) {
    const diff = Math.abs(t.px - target);
    if (!best || diff < best.diff) {
      best = { token: { token: `--${t.name}`, value: t.value }, diff };
    }
  }
  if (!best || best.diff > target * SPACING_TOLERANCE) return null;
  return best.token;
}

/**
 * Suggestion for one compliance issue, based on its rule and offending
 * literal. Null when the value is novel or the rule has no token space.
 */
export function suggestForIssue(
  issue: Pick<ComplianceIssue, "ruleId" | "value">,
  kit: Kit,
): TokenSuggestion | null {
  if (!issue.value) return null;
  if (issue.ruleId === "hardcoded-colours") {
    return nearestColourToken(issue.value, kitColourTokens(kit));
  }
  if (issue.ruleId === "hardcoded-spacing") {
    return nearestSpacingToken(issue.value, kitSpacingTokens(kit));
  }
  return null;
}
