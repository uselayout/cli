/**
 * list-tokens MCP tool: flat categorised token inventory as JSON.
 *
 * Covers the tokens.css parse (light + dark blocks), the name/value category
 * heuristics, the DTCG $type override from tokens.json, and the no-kit /
 * no-tokens.css edges.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as listTokens from "../src/mcp/tools/list-tokens.js";
import type { ListedToken } from "../src/mcp/tools/list-tokens.js";
import type { Kit } from "../src/kit/types.js";

function makeKit(overrides: Partial<Kit> = {}): Kit {
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
    ...overrides,
  };
}

async function run(kit: Kit | null): Promise<string> {
  const result = await listTokens.handler(kit)();
  return result.content[0]!.text;
}

async function runJson(kit: Kit | null): Promise<ListedToken[]> {
  return JSON.parse(await run(kit)) as ListedToken[];
}

test("exports the standard tool module shape", () => {
  assert.equal(listTokens.name, "list-tokens");
  assert.equal(typeof listTokens.description, "string");
  assert.ok(listTokens.description.length > 20);
  assert.equal(typeof listTokens.inputSchema, "object");
  assert.equal(typeof listTokens.handler, "function");
  assert.equal(typeof listTokens.handler(null), "function");
});

test("registers on a real McpServer without throwing", () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  assert.doesNotThrow(() =>
    server.tool(
      listTokens.name,
      listTokens.description,
      listTokens.inputSchema,
      listTokens.handler(null)
    )
  );
});

test("no kit → setup message, not JSON", async () => {
  const text = await run(null);
  assert.match(text, /No design system kit found/);
});

test("kit without tokens.css → empty JSON array", async () => {
  assert.deepEqual(await runJson(makeKit()), []);
});

test("categorises tokens.css vars by name/value heuristics", async () => {
  const kit = makeKit({
    tokensCss: `:root {
      --color-primary: #6366f1;
      --surface-raised: rgba(0, 0, 0, 0.5);
      --font-sans: Inter, ui-sans-serif, sans-serif;
      --leading-tight: 1.25;
      --space-4: 16px;
      --gap-lg: 2rem;
      --radius-md: 8px;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
      --z-overlay: 999;
      --text-sm: 0.875rem;
    }`,
  });
  const tokens = await runJson(kit);
  const byVar = new Map(tokens.map((t) => [t.cssVar, t]));

  assert.equal(byVar.get("--color-primary")?.category, "color");
  assert.equal(byVar.get("--surface-raised")?.category, "color");
  assert.equal(byVar.get("--font-sans")?.category, "typography");
  assert.equal(byVar.get("--leading-tight")?.category, "typography");
  assert.equal(byVar.get("--space-4")?.category, "spacing");
  assert.equal(byVar.get("--gap-lg")?.category, "spacing");
  assert.equal(byVar.get("--radius-md")?.category, "radius");
  assert.equal(byVar.get("--shadow-sm")?.category, "shadow");
  assert.equal(byVar.get("--z-overlay")?.category, "other");
  // A dimension named text-* is a font size, not a colour.
  assert.equal(byVar.get("--text-sm")?.category, "typography");
  // Values and default mode come through untouched.
  assert.equal(byVar.get("--color-primary")?.value, "#6366f1");
  assert.ok(tokens.every((t) => t.mode === "light"));
});

test('tags values under a [data-theme="dark"] block as mode "dark"', async () => {
  const kit = makeKit({
    tokensCss: `:root { --color-primary: #6366f1; --color-bg: #ffffff; }
      [data-theme="dark"] { --color-primary: #818cf8; --color-bg: #0c0c0e; }`,
  });
  const tokens = await runJson(kit);
  const primary = tokens.filter((t) => t.cssVar === "--color-primary");
  assert.equal(primary.length, 2);
  assert.deepEqual(
    primary.map((t) => t.mode).sort(),
    ["dark", "light"]
  );
  assert.equal(primary.find((t) => t.mode === "dark")?.value, "#818cf8");
});

test("@media prefers-color-scheme dark duplicates are dark, deduped with [data-theme]", async () => {
  // Exact Studio-generated shape: every dark token is emitted twice, under
  // [data-theme="dark"] AND inside @media (prefers-color-scheme: dark).
  // Both must classify as dark and collapse to ONE dark entry, otherwise
  // Live's Design tab shows a bogus light row carrying the dark value.
  const kit = makeKit({
    tokensCss: `:root {
  --color-primary: #6366f1;
  --color-bg: #ffffff;
}

[data-theme="dark"] {
  --color-primary: #818cf8;
  --color-bg: #0c0c0e;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #818cf8;
    --color-bg: #0c0c0e;
  }
}
`,
  });
  const tokens = await runJson(kit);
  for (const cssVar of ["--color-primary", "--color-bg"]) {
    const entries = tokens.filter((t) => t.cssVar === cssVar);
    assert.equal(entries.length, 2, `${cssVar}: one light + one dark entry`);
    assert.deepEqual(entries.map((t) => t.mode).sort(), ["dark", "light"]);
  }
  assert.equal(
    tokens.find((t) => t.cssVar === "--color-primary" && t.mode === "light")
      ?.value,
    "#6366f1"
  );
  assert.equal(
    tokens.find((t) => t.cssVar === "--color-primary" && t.mode === "dark")
      ?.value,
    "#818cf8"
  );
});

test("DTCG $type from tokens.json overrides the heuristics", async () => {
  const kit = makeKit({
    // Heuristics alone would file --ramp-1 under "other" (no space/gap name)
    // and --ink under "other" (no colour value or colour-ish name).
    tokensCss: `:root { --ramp-1: 4px; --ink: var(--brand-900); }`,
    tokensJson: JSON.stringify({
      ramp: { "1": { $type: "dimension", $value: "4px" } },
      ink: { $type: "color", $value: "{brand.900}" },
    }),
  });
  const tokens = await runJson(kit);
  const byVar = new Map(tokens.map((t) => [t.cssVar, t]));
  assert.equal(byVar.get("--ramp-1")?.category, "spacing");
  assert.equal(byVar.get("--ink")?.category, "color");
});

test("malformed tokens.json falls back to heuristics without throwing", async () => {
  const kit = makeKit({
    tokensCss: `:root { --color-primary: #123456; }`,
    tokensJson: "{ not json",
  });
  const tokens = await runJson(kit);
  assert.equal(tokens[0]?.category, "color");
});
