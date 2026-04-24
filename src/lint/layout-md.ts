// Linter for the layout.md format. Runs over a loaded Kit (layout.md + the
// companion tokens.css / tokens.json) and reports issues. Callers get either
// a structured array (for JSON output + CI integration) or a human-readable
// pretty-printed summary.
//
// The seven rules mirror the checks Google's design.md CLI ships with, plus
// the specifics our three-tier token system wants to enforce.

import type { Kit } from "../kit/types.js";

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  ruleId: string;
  severity: LintSeverity;
  message: string;
  file?: "layout.md" | "tokens.css" | "tokens.json";
  line?: number;
  detail?: Record<string, unknown>;
}

export interface LintResult {
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    passed: boolean;
  };
}

const CANONICAL_SECTIONS = [
  "Quick Reference",
  "Design Direction",
  "Colour System",
  "Typography System",
  "Spacing",
  "Components",
  "Elevation",
  "Motion",
  "Anti-Patterns",
] as const;

// Parses `--name: value;` declarations out of a CSS string using matchAll
// rather than stateful regex iteration.
function parseCssDeclarations(css: string): Array<{ name: string; value: string; index: number }> {
  const pattern = /^\s*(--[a-zA-Z0-9_-]+)\s*:\s*([^;\n]+);/gm;
  const out: Array<{ name: string; value: string; index: number }> = [];
  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    const value = match[2];
    if (name && value) out.push({ name, value: value.trim(), index: match.index ?? 0 });
  }
  return out;
}

// ── Rule 1 ─────────────────────────────────────────────────────────────────
// broken-token-ref: every var(--name) in layout.md must resolve to a token
// defined in tokens.css.
function ruleBrokenTokenRef(kit: Kit): LintIssue[] {
  const issues: LintIssue[] = [];
  const defined = new Set<string>();
  if (kit.tokensCss) {
    for (const decl of parseCssDeclarations(kit.tokensCss)) defined.add(decl.name);
  }
  const pattern = /var\((--[a-zA-Z0-9_-]+)\)/g;
  const seen = new Set<string>();
  for (const match of kit.layoutMd.matchAll(pattern)) {
    const name = match[1];
    if (!name) continue;
    if (defined.size > 0 && !defined.has(name) && !seen.has(name)) {
      seen.add(name);
      issues.push({
        ruleId: "broken-token-ref",
        severity: "warning",
        message: `layout.md references var(${name}) but no definition exists in tokens.css.`,
        file: "layout.md",
        line: lineNumberOf(kit.layoutMd, match.index ?? 0),
        detail: { token: name },
      });
    }
  }
  return issues;
}

// ── Rule 2 ─────────────────────────────────────────────────────────────────
// orphaned-tokens: tokens defined in tokens.css but never referenced anywhere
// in layout.md.
function ruleOrphanedTokens(kit: Kit): LintIssue[] {
  if (!kit.tokensCss) return [];
  const issues: LintIssue[] = [];
  const declarations = parseCssDeclarations(kit.tokensCss);

  const referenced = new Set<string>();
  for (const match of kit.layoutMd.matchAll(/var\((--[a-zA-Z0-9_-]+)\)/g)) {
    if (match[1]) referenced.add(match[1]);
  }

  for (const decl of declarations) {
    if (!referenced.has(decl.name)) {
      issues.push({
        ruleId: "orphaned-tokens",
        severity: "info",
        message: `Token ${decl.name} is defined in tokens.css but never referenced in layout.md.`,
        file: "tokens.css",
        detail: { token: decl.name },
      });
    }
  }
  return issues;
}

// ── Rule 3 ─────────────────────────────────────────────────────────────────
// wcag-aa-contrast: detectable colour pairs must clear 4.5:1 contrast.
function ruleWcagAaContrast(kit: Kit): LintIssue[] {
  if (!kit.tokensCss) return [];
  const issues: LintIssue[] = [];
  const colours = parseCssColourTokens(kit.tokensCss);

  const pairs: Array<{ fg: string; bg: string; context: string }> = [];
  for (const [name] of colours) {
    if (name === "--color-primary") {
      const onName = "--color-on-primary";
      if (colours.has(onName)) pairs.push({ fg: onName, bg: name, context: "on-primary" });
    }
  }
  for (const [txtName] of colours) {
    if (!txtName.startsWith("--text-") && !txtName.startsWith("--color-on-")) continue;
    for (const [bgName] of colours) {
      if (!bgName.startsWith("--bg-") && !bgName.startsWith("--color-bg-")) continue;
      if (txtName === "--text-primary" && bgName === "--bg-app") {
        pairs.push({ fg: txtName, bg: bgName, context: "body text on app background" });
      }
    }
  }

  for (const pair of pairs) {
    const fg = colours.get(pair.fg);
    const bg = colours.get(pair.bg);
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio === null) continue;
    if (ratio < 4.5) {
      issues.push({
        ruleId: "wcag-aa-contrast",
        severity: "warning",
        message: `Contrast between ${pair.fg} and ${pair.bg} is ${ratio.toFixed(2)}:1, below WCAG AA threshold (4.5:1) for ${pair.context}.`,
        file: "tokens.css",
        detail: { fg: pair.fg, bg: pair.bg, ratio },
      });
    }
  }
  return issues;
}

// ── Rule 4 ─────────────────────────────────────────────────────────────────
// section-ordering: canonical order enforced when sections are present.
function ruleSectionOrdering(kit: Kit): LintIssue[] {
  const positions: Array<{ name: string; idx: number }> = [];
  for (const canonical of CANONICAL_SECTIONS) {
    const pattern = new RegExp(`^##\\s+.*${escapeRegex(canonical)}`, "mi");
    const match = kit.layoutMd.match(pattern);
    if (match && match.index !== undefined) positions.push({ name: canonical, idx: match.index });
  }
  const issues: LintIssue[] = [];
  for (let i = 1; i < positions.length; i++) {
    const current = positions[i]!;
    const previous = positions[i - 1]!;
    if (current.idx < previous.idx) {
      issues.push({
        ruleId: "section-ordering",
        severity: "info",
        message: `Section "${current.name}" appears before "${previous.name}" in layout.md. Canonical order: Quick Reference, Design Direction, Colour System, Typography, Spacing, Components, Elevation, Motion, Anti-Patterns.`,
        file: "layout.md",
        line: lineNumberOf(kit.layoutMd, current.idx),
      });
    }
  }
  return issues;
}

// ── Rule 5 ─────────────────────────────────────────────────────────────────
// missing-primary: layout.md carries at least one primary/accent colour.
function ruleMissingPrimary(kit: Kit): LintIssue[] {
  if (!kit.tokensCss) return [];
  const defined = parseCssDeclarations(kit.tokensCss).map((d) => d.name);
  // Accept any token whose basename ends in -primary, -accent, -brand, or
  // matches the bare names. This tolerates prefixed kits like --linear-accent,
  // --stripe-primary, --acme-brand.
  const hasAny = defined.some((name) =>
    /(?:^|-)(primary|accent|brand)$/.test(name),
  );
  if (hasAny) return [];
  return [
    {
      ruleId: "missing-primary",
      severity: "error",
      message: `No primary/accent/brand colour token found. Expected any token whose name ends in -primary, -accent, or -brand (e.g. --color-primary, --linear-accent, --acme-brand).`,
      file: "tokens.css",
    },
  ];
}

// ── Rule 6 ─────────────────────────────────────────────────────────────────
// circular-alias: --a: var(--b); --b: var(--a).
function ruleCircularAlias(kit: Kit): LintIssue[] {
  if (!kit.tokensCss) return [];
  const issues: LintIssue[] = [];
  const aliases = new Map<string, string>();
  for (const match of kit.tokensCss.matchAll(
    /^\s*(--[a-zA-Z0-9_-]+)\s*:\s*var\((--[a-zA-Z0-9_-]+)\)\s*;/gm,
  )) {
    const from = match[1];
    const to = match[2];
    if (from && to) aliases.set(from, to);
  }

  const seen = new Set<string>();
  for (const [from] of aliases) {
    if (seen.has(from)) continue;
    const chain: string[] = [from];
    let current = from;
    while (aliases.has(current)) {
      const next = aliases.get(current);
      if (!next) break;
      if (chain.includes(next)) {
        chain.push(next);
        issues.push({
          ruleId: "circular-alias",
          severity: "error",
          message: `Circular token alias: ${chain.join(" -> ")}.`,
          file: "tokens.css",
          detail: { chain },
        });
        chain.forEach((c) => seen.add(c));
        break;
      }
      chain.push(next);
      current = next;
      if (chain.length > 32) break;
    }
    seen.add(from);
  }
  return issues;
}

// ── Rule 7 ─────────────────────────────────────────────────────────────────
// unknown-property: tokens.json entries whose $type is outside the W3C DTCG
// set Layout's exporters produce.
function ruleUnknownProperty(kit: Kit): LintIssue[] {
  if (!kit.tokensJson) return [];
  const issues: LintIssue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(kit.tokensJson);
  } catch {
    return [
      {
        ruleId: "unknown-property",
        severity: "error",
        message: "tokens.json is not valid JSON.",
        file: "tokens.json",
      },
    ];
  }
  const allowed = new Set([
    "color",
    "dimension",
    "fontFamily",
    "fontWeight",
    "fontSize",
    "lineHeight",
    "letterSpacing",
    "typography",
    "shadow",
    "border",
    "duration",
    "cubicBezier",
    "motion",
    "number",
    "string",
  ]);

  walkTokens(parsed as Record<string, unknown>, (path, value) => {
    if (value && typeof value === "object" && "$type" in value) {
      const t = (value as { $type?: unknown }).$type;
      if (typeof t === "string" && !allowed.has(t)) {
        issues.push({
          ruleId: "unknown-property",
          severity: "info",
          message: `Token ${path} declares $type "${t}" which is not in the W3C DTCG vocabulary Layout emits.`,
          file: "tokens.json",
          detail: { path, type: t },
        });
      }
    }
  });
  return issues;
}

// Helpers ────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function walkTokens(
  obj: Record<string, unknown>,
  visit: (path: string, value: Record<string, unknown>) => void,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      if ("$value" in (value as object)) {
        visit(next, value as Record<string, unknown>);
      } else {
        walkTokens(value as Record<string, unknown>, visit, next);
      }
    }
  }
}

function parseCssColourTokens(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of parseCssDeclarations(css)) {
    if (isColourValue(decl.value)) map.set(decl.name, decl.value);
  }
  return map;
}

function isColourValue(v: string): boolean {
  return /^#([0-9a-fA-F]{3,8})$/.test(v) || /^rgb\(/i.test(v) || /^rgba\(/i.test(v);
}

function parseHex(value: string): [number, number, number, number] | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
  if (!match || !match[1]) return null;
  let hex: string = match[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

function parseRgb(value: string): [number, number, number, number] | null {
  const match = /^rgba?\(\s*([^)]+)\)\s*$/i.exec(value.trim());
  if (!match || !match[1]) return null;
  const parts = match[1].split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const r = Number.parseFloat(parts[0]!);
  const g = Number.parseFloat(parts[1]!);
  const b = Number.parseFloat(parts[2]!);
  const a = parts[3] !== undefined ? Number.parseFloat(parts[3]) : 1;
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [r, g, b, a];
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: string, bg: string): number | null {
  const fgRgb = parseHex(fg) ?? parseRgb(fg);
  const bgRgb = parseHex(bg) ?? parseRgb(bg);
  if (!fgRgb || !bgRgb) return null;
  const l1 = relativeLuminance([fgRgb[0], fgRgb[1], fgRgb[2]]);
  const l2 = relativeLuminance([bgRgb[0], bgRgb[1], bgRgb[2]]);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function lintKit(kit: Kit): LintResult {
  const rules = [
    ruleBrokenTokenRef,
    ruleOrphanedTokens,
    ruleWcagAaContrast,
    ruleSectionOrdering,
    ruleMissingPrimary,
    ruleCircularAlias,
    ruleUnknownProperty,
  ];
  const issues: LintIssue[] = rules.flatMap((r) => r(kit));
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;
  return {
    issues,
    summary: { errors, warnings, info, passed: errors === 0 },
  };
}
