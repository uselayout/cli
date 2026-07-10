/**
 * design.md emitter — stable-output test against a small fixture kit.
 *
 * The emitter is a 1:1 port of layout-studio/lib/export/design-md.ts; the
 * exact-string assertion below is the local half of that byte-parity contract.
 * If this test needs updating, the Studio generator changed (or vice versa) —
 * keep both sides in sync.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDesignMd } from "../src/export/design-md.js";
import { kitDesignTokens, parseCssVariables } from "../src/export/kit-tokens.js";
import type { Kit } from "../src/kit/types.js";

const FIXTURE_TOKENS_JSON = JSON.stringify({
  color: {
    bg: { app: { $type: "color", $value: "#0A0A0F" } },
    accent: { default: { $type: "color", $value: "#5E6AD2" } },
  },
  font: {
    sans: { $type: "fontFamily", $value: ["Inter", "sans-serif"] },
  },
  spacing: {
    sm: { $type: "dimension", $value: "8px" },
  },
  radius: {
    md: { $type: "dimension", $value: "6px" },
  },
});

const FIXTURE_KIT: Kit = {
  manifest: {
    name: "fixture-kit",
    version: "1.0.0",
    displayName: "Fixture Kit",
    description: "A tiny kit for tests",
    source: "test",
    tier: "free",
    tokenCount: 5,
    componentCount: 0,
    aesthetic: "Minimal",
  },
  layoutMd: "# Fixture Kit\n\nBody prose.",
  sections: [],
  components: [],
  tokensJson: FIXTURE_TOKENS_JSON,
};

test("generateDesignMd emits stable design.md output for a fixture kit", () => {
  const tokens = kitDesignTokens(FIXTURE_KIT);
  assert.ok(tokens, "tokens derived from DTCG json");

  const output = generateDesignMd({
    name: FIXTURE_KIT.manifest.displayName,
    layoutMd: FIXTURE_KIT.layoutMd,
    extractionData: { tokens },
  });

  const expected = `---
name: "Fixture Kit"

generator: "Layout (layout.design)"

layoutMdVersion: 1

colors:
  color-bg-app: "#0A0A0F"
  color-accent-default: "#5E6AD2"

typography:
  font-sans: "Inter, sans-serif"

dimensions:
  spacing-sm: 8px

rounded:
  radius-md: 6px
---

<!--
  This file is emitted by Layout (https://layout.design) as a companion to
  the canonical layout.md. It is formatted for compatibility with agents
  that follow Google's design.md spec (github.com/google-labs-code/design.md).

  The frontmatter above carries the design system's tokens in a design.md
  compatible shape. The prose below is the full layout.md content, which
  is a superset (three-tier tokens, multi-mode, confidence annotations).
-->

# Fixture Kit

Body prose.
`;
  assert.equal(output, expected);

  // Re-running produces byte-identical output (stable generator).
  const again = generateDesignMd({
    name: FIXTURE_KIT.manifest.displayName,
    layoutMd: FIXTURE_KIT.layoutMd,
    extractionData: { tokens },
  });
  assert.equal(again, output);
});

test("mode-scoped tokens are excluded from design.md frontmatter", () => {
  const output = generateDesignMd({
    name: "Modes",
    layoutMd: "# Modes",
    extractionData: {
      tokens: {
        colors: [
          { name: "bg", value: "#fff" },
          { name: "bg", value: "#000", mode: "dark" },
        ],
        typography: [],
        spacing: [],
        radius: [],
        effects: [],
      },
    },
  });
  assert.ok(output.includes("  bg: \"#fff\""));
  assert.ok(!output.includes("#000"), "dark-mode token stays out of frontmatter");
});

test("parseCssVariables reads :root and dark blocks", () => {
  const css = `:root {\n  --a: #fff;\n  --b: 8px;\n}\n[data-theme="dark"] {\n  --a: #000;\n}\n`;
  const vars = parseCssVariables(css);
  assert.deepEqual(vars, [
    { name: "a", value: "#fff", mode: undefined },
    { name: "b", value: "8px", mode: undefined },
    { name: "a", value: "#000", mode: "dark" },
  ]);
});

test("parseCssVariables tags @media prefers-color-scheme dark as dark and dedupes", () => {
  // Studio's generator always emits the dark tokens twice: [data-theme="dark"]
  // plus an @media (prefers-color-scheme: dark) { :root { ... } } duplicate.
  const css = `:root {\n  --a: #fff;\n}\n[data-theme="dark"] {\n  --a: #000;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --a: #000;\n  }\n}\n`;
  assert.deepEqual(parseCssVariables(css), [
    { name: "a", value: "#fff", mode: undefined },
    { name: "a", value: "#000", mode: "dark" },
  ]);
});

test("kitDesignTokens falls back to tokens.css heuristics", () => {
  const kit: Kit = {
    ...FIXTURE_KIT,
    tokensJson: undefined,
    tokensCss:
      ":root {\n  --x-bg: #111;\n  --x-font-sans: Inter;\n  --x-space-sm: 8px;\n  --x-radius-md: 6px;\n  --x-shadow-1: 0 1px 2px rgba(0,0,0,.3);\n}\n",
  };
  const tokens = kitDesignTokens(kit);
  assert.ok(tokens);
  assert.equal(tokens.colors[0]?.name, "x-bg");
  assert.equal(tokens.typography[0]?.name, "x-font-sans");
  assert.equal(tokens.spacing[0]?.name, "x-space-sm");
  assert.equal(tokens.radius[0]?.name, "x-radius-md");
  assert.equal(tokens.effects[0]?.name, "x-shadow-1");
});
