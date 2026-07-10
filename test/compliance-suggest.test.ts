/**
 * Nearest-token suggestion engine: colour parsing, redmean distance matching,
 * spacing-scale matching, and the "no suggestion for novel values" thresholds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseColour,
  colourDistance,
  nearestColourToken,
  nearestSpacingToken,
  suggestForIssue,
  COLOUR_DISTANCE_THRESHOLD,
} from "../src/compliance/suggest.js";
import { checkCompliance } from "../src/compliance/checker.js";
import type { Kit } from "../src/kit/types.js";

function makeKit(tokensCss?: string): Kit {
  return {
    manifest: {
      name: "test-kit",
      version: "1.0.0",
      displayName: "Test Kit",
      description: "fixture",
      source: "test",
      tier: "free",
      tokenCount: 0,
      componentCount: 0,
      aesthetic: "test",
    },
    layoutMd: "# Test",
    sections: [],
    components: [],
    ...(tokensCss !== undefined && { tokensCss }),
  };
}

const TOKENS_CSS = `:root {
  --color-primary: #6366f1;
  --color-danger: rgb(220, 38, 38);
  --color-surface: hsl(240, 5%, 96%);
  --space-1: 4px;
  --space-4: 16px;
  --space-6: 1.5rem;
  --font-sans: Inter, sans-serif;
}
[data-theme="dark"] { --color-primary: #818cf8; }`;

test("parseColour handles hex (3/6/8), rgb() and hsl(), keeping alpha", () => {
  assert.deepEqual(parseColour("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColour("#6366F1"), { r: 99, g: 102, b: 241, a: 1 });
  assert.deepEqual(parseColour("#6366f1cc"), { r: 99, g: 102, b: 241, a: 0.8 });
  assert.deepEqual(parseColour("rgb(220, 38, 38)"), {
    r: 220,
    g: 38,
    b: 38,
    a: 1,
  });
  assert.deepEqual(parseColour("rgba(220 38 38 / 0.5)"), {
    r: 220,
    g: 38,
    b: 38,
    a: 0.5,
  });
  assert.deepEqual(parseColour("rgba(0, 0, 0, 0.45)"), {
    r: 0,
    g: 0,
    b: 0,
    a: 0.45,
  });
  assert.deepEqual(parseColour("rgb(0 0 0 / 45%)"), { r: 0, g: 0, b: 0, a: 0.45 });
  assert.deepEqual(parseColour("hsl(0, 100%, 50%)"), {
    r: 255,
    g: 0,
    b: 0,
    a: 1,
  });
  assert.equal(parseColour("hsla(0, 100%, 50%, 0.3)")?.a, 0.3);
  assert.equal(parseColour("var(--color-primary)"), null);
  assert.equal(parseColour("rebeccapurple"), null);
  assert.equal(parseColour("rgb(300, 0, 0)"), null);
});

test("colourDistance is zero for identical colours and large for opposites", () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  assert.equal(colourDistance(black, black), 0);
  assert.ok(colourDistance(black, white) > 700);
  assert.ok(colourDistance(black, white) > COLOUR_DISTANCE_THRESHOLD);
});

test("nearestColourToken picks the closest token within threshold", () => {
  const tokens = [
    { name: "color-primary", value: "#6366f1" },
    { name: "color-danger", value: "#dc2626" },
  ];
  // #6466f0 is a hair away from --color-primary.
  assert.deepEqual(nearestColourToken("#6466f0", tokens), {
    token: "--color-primary",
    value: "#6366f1",
  });
  // A near-danger red maps to --color-danger, not primary.
  assert.deepEqual(nearestColourToken("rgb(224, 40, 40)", tokens), {
    token: "--color-danger",
    value: "#dc2626",
  });
});

test("nearestColourToken returns null for a genuinely novel colour", () => {
  const tokens = [
    { name: "color-primary", value: "#6366f1" },
    { name: "color-danger", value: "#dc2626" },
  ];
  // Pure green is nowhere near indigo or red.
  assert.equal(nearestColourToken("#00ff00", tokens), null);
  // Unparseable input never suggests.
  assert.equal(nearestColourToken("var(--x)", tokens), null);
  // No tokens, no suggestion.
  assert.equal(nearestColourToken("#6366f1", []), null);
});

test("translucent literals never suggest solid tokens (alpha-aware matching)", () => {
  const ink = [{ name: "color-ink", value: "#000000" }];
  // A 45% scrim is not the ink token, even though the RGB channels match:
  // applying the suggestion would turn the overlay opaque.
  assert.equal(nearestColourToken("rgba(0, 0, 0, 0.45)", ink), null);
  assert.equal(nearestColourToken("#00000073", ink), null);
  // A token with the same translucency is still a confident match.
  const scrim = [{ name: "color-scrim", value: "rgb(0 0 0 / 0.45)" }];
  assert.deepEqual(nearestColourToken("rgba(0, 0, 0, 0.45)", scrim), {
    token: "--color-scrim",
    value: "rgb(0 0 0 / 0.45)",
  });
  // #00000073 is 45.1% alpha: close enough to a 0.45 token to match.
  assert.deepEqual(nearestColourToken("#00000073", scrim), {
    token: "--color-scrim",
    value: "rgb(0 0 0 / 0.45)",
  });
  // And an opaque literal never picks up a translucent token.
  assert.equal(nearestColourToken("#000000", scrim), null);
});

test("dark-mode values (incl. the @media duplicate) stay out of the suggestion pool", () => {
  // Studio-generated shape: every dark token is emitted twice, under
  // [data-theme="dark"] AND inside @media (prefers-color-scheme: dark).
  const kit = makeKit(`:root {
  --color-surface: #ffffff;
}

[data-theme="dark"] {
  --color-surface: #111114;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-surface: #111114;
  }
}
`);
  // #16161a is near the DARK surface value only. Suggesting --color-surface
  // would render #ffffff in light mode, flipping near-black to white.
  assert.equal(
    suggestForIssue({ ruleId: "hardcoded-colours", value: "#16161a" }, kit),
    null
  );
  // The base (light) value still suggests as before.
  assert.deepEqual(
    suggestForIssue({ ruleId: "hardcoded-colours", value: "#fdfdfd" }, kit),
    { token: "--color-surface", value: "#ffffff" }
  );
});

test("nearestSpacingToken matches within 25% and rejects beyond it", () => {
  const tokens = [
    { name: "space-1", px: 4, value: "4px" },
    { name: "space-4", px: 16, value: "16px" },
    { name: "space-6", px: 24, value: "1.5rem" },
  ];
  // 13px → 16px is 18.75% off: within tolerance.
  assert.deepEqual(nearestSpacingToken("13px", tokens), {
    token: "--space-4",
    value: "16px",
  });
  // 100px is 316% away from the nearest token (24px): novel.
  assert.equal(nearestSpacingToken("100px", tokens), null);
  // Exact match always suggests.
  assert.deepEqual(nearestSpacingToken("24px", tokens), {
    token: "--space-6",
    value: "1.5rem",
  });
});

test("suggestForIssue routes by ruleId and reads tokens from the kit", () => {
  const kit = makeKit(TOKENS_CSS);
  assert.deepEqual(
    suggestForIssue({ ruleId: "hardcoded-colours", value: "#6467f2" }, kit),
    { token: "--color-primary", value: "#6366f1" }
  );
  assert.deepEqual(
    suggestForIssue({ ruleId: "hardcoded-spacing", value: "15px" }, kit),
    { token: "--space-4", value: "16px" }
  );
  // Unknown rule / missing value / kit without tokens.css → null.
  assert.equal(
    suggestForIssue({ ruleId: "unknown-component", value: "#fff" }, kit),
    null
  );
  assert.equal(suggestForIssue({ ruleId: "hardcoded-colours" }, kit), null);
  assert.equal(
    suggestForIssue({ ruleId: "hardcoded-colours", value: "#6366f1" }, makeKit()),
    null
  );
});

test("checkCompliance populates value, column and suggestion on issues", () => {
  const kit = makeKit(TOKENS_CSS);
  const code = `const s = { color: "#6467f2", margin: "13px" };
const box = "margin: 13px";`;
  const result = checkCompliance(code, kit);

  const colour = result.issues.find((i) => i.ruleId === "hardcoded-colours");
  assert.ok(colour);
  assert.equal(colour.value, "#6467f2");
  assert.equal(colour.line, 1);
  assert.equal(colour.column, code.indexOf("#6467f2") + 1);
  assert.deepEqual(colour.suggestion, {
    token: "--color-primary",
    value: "#6366f1",
  });

  const spacing = result.issues.find((i) => i.ruleId === "hardcoded-spacing");
  assert.ok(spacing);
  assert.equal(spacing.value, "13px");
  assert.equal(spacing.line, 2);
  assert.deepEqual(spacing.suggestion, { token: "--space-4", value: "16px" });
});

test("checkCompliance marks a novel colour with suggestion: null", () => {
  const kit = makeKit(TOKENS_CSS);
  const result = checkCompliance(`const c = "#00ff00";`, kit);
  const colour = result.issues.find((i) => i.ruleId === "hardcoded-colours");
  assert.ok(colour);
  assert.equal(colour.suggestion, null);
});
