/**
 * list-components MCP tool: the structured `format: "json"` output (component
 * inventory for programmatic consumers like Layout Live) and the unchanged
 * default text output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as listComponentsTool from "../src/mcp/tools/list-components.js";
import type { ComponentListEntry } from "../src/mcp/tools/list-components.js";
import type { Kit } from "../src/kit/types.js";
import type { ScanResult } from "../src/integrations/codebase-scan.js";

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
    components: [
      {
        name: "Button",
        description: "Primary action button",
        tokens: ["--color-primary"],
        codeExample: `<button className="btn">Go</button>`,
      },
      { name: "Badge", description: "", tokens: [] },
    ],
    ...overrides,
  };
}

function makeScan(): ScanResult {
  return {
    rootPath: "/proj",
    components: [
      {
        name: "Card",
        filePath: "src/components/Card.tsx",
        exportType: "named",
        props: [{ name: "title" }, { name: "children" }],
        usesForwardRef: false,
        storybook: {
          componentName: "Card",
          title: "Components/Card",
          filePath: "src/components/Card.stories.tsx",
          args: [],
          stories: [{ name: "Default" }, { name: "WithImage" }],
        },
      },
    ],
    storybookStories: [],
    unmatchedStories: [],
    filesScanned: 1,
    durationMs: 1,
  };
}

async function run(
  kit: Kit | null,
  scan: ScanResult | null,
  args: { format?: "text" | "json" } = {}
): Promise<string> {
  const result = await listComponentsTool.handler(kit, scan)(args);
  return result.content[0]!.text;
}

test("exports the standard tool module shape", () => {
  assert.equal(listComponentsTool.name, "list-components");
  assert.equal(typeof listComponentsTool.description, "string");
  assert.ok(listComponentsTool.description.length > 20);
  assert.equal(typeof listComponentsTool.inputSchema, "object");
  assert.equal(typeof listComponentsTool.handler, "function");
  assert.equal(typeof listComponentsTool.handler(null, null), "function");
});

test("registers on a real McpServer without throwing", () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  assert.doesNotThrow(() =>
    server.tool(
      listComponentsTool.name,
      listComponentsTool.description,
      listComponentsTool.inputSchema,
      listComponentsTool.handler(null, null)
    )
  );
});

test("default text output is unchanged (agents parse it)", async () => {
  const text = await run(makeKit(), makeScan());
  assert.match(text, /^# Components \(3\)/);
  assert.match(text, /## Design System \(from layout\.md\)/);
  // \u2014 is the separator the legacy text output has always used.
  assert.match(text, /- \*\*Button\*\* \u2014 Primary action button/);
  assert.match(text, /- \*\*Badge\*\* \u2014 No description/);
  assert.match(text, /## Your Codebase \(auto-detected\)/);
  assert.match(
    text,
    /- \*\*Card\*\* \(src\/components\/Card\.tsx\) props: title, children \[Storybook: Default, WithImage\]/
  );
  assert.match(text, /Import: `import \{ Card \} from '@\/components\/Card'`/);
});

test("text output with no components is unchanged", async () => {
  const text = await run(null, null);
  assert.match(text, /^No components found\./);
});

test("format json returns a structured component list", async () => {
  const text = await run(makeKit(), makeScan(), { format: "json" });
  const parsed = JSON.parse(text) as { components: ComponentListEntry[] };
  assert.equal(parsed.components.length, 3);

  const button = parsed.components[0]!;
  assert.deepEqual(button, {
    name: "Button",
    description: "Primary action button",
    source: "design-system",
    hasCode: true,
    tokens: ["--color-primary"],
  });

  // Empty description / no code example / no tokens → optional keys omitted.
  const badge = parsed.components[1]!;
  assert.deepEqual(badge, {
    name: "Badge",
    source: "design-system",
    hasCode: false,
  });

  const card = parsed.components[2]!;
  assert.deepEqual(card, {
    name: "Card",
    source: "codebase",
    hasCode: false,
    filePath: "src/components/Card.tsx",
    props: ["title", "children"],
    stories: ["Default", "WithImage"],
  });
});

test("format json with no kit and no scan returns an empty list (not prose)", async () => {
  const text = await run(null, null, { format: "json" });
  const parsed = JSON.parse(text) as { components: ComponentListEntry[] };
  assert.deepEqual(parsed.components, []);
});
