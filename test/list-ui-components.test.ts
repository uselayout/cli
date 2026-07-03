/**
 * Unit tests for the `list-ui-components` MCP tool: catalogue formatting, index
 * caching, and graceful degradation on fetch failure. The network is mocked via
 * an injected IndexFetcher (mirrors registry-add.test.ts conventions).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCatalogue,
  fetchRegistryIndex,
  handler,
  _clearIndexCache,
  type IndexFetcher,
} from "../src/mcp/tools/list-ui-components.js";
import type { RegistryIndex } from "../src/registry/index.js";

const SAMPLE: RegistryIndex = {
  name: "layout-ui",
  items: [
    {
      name: "theme-layout",
      type: "registry:theme",
      title: "Layout default theme",
      description: "A theme, not a component.",
    },
    {
      name: "button",
      type: "registry:ui",
      title: "Button",
      description: "A clickable action.",
      meta: {
        usage: "Use for primary and secondary actions.",
        never: ["Never nest a button inside a button", "Never remove the focus ring"],
        tokens: ["--layout-primary"],
      },
    },
    {
      name: "spinner",
      type: "registry:ui",
      title: "Spinner",
      description: "A loading indicator.",
    },
  ],
};

// --- formatCatalogue --------------------------------------------------------

test("formatCatalogue lists only registry:ui items with install hints", () => {
  const out = formatCatalogue(SAMPLE);
  // Themes are excluded; the two UI components are counted.
  assert.match(out, /# Layout UI components \(2\)/);
  assert.doesNotMatch(out, /theme-layout/);
  assert.match(out, /### button — Button/);
  assert.match(out, /Install: `npx @layoutdesign\/context add button`/);
  assert.match(out, /### spinner — Spinner/);
  assert.match(out, /Install: `npx @layoutdesign\/context add spinner`/);
});

test("formatCatalogue includes usage and never rules when present", () => {
  const out = formatCatalogue(SAMPLE);
  assert.match(out, /Usage: Use for primary and secondary actions\./);
  assert.match(out, /Never:/);
  assert.match(out, /- Never nest a button inside a button/);
  assert.match(out, /- Never remove the focus ring/);
});

test("formatCatalogue omits usage/never for items without meta", () => {
  const out = formatCatalogue({
    items: [{ name: "spinner", type: "registry:ui", title: "Spinner" }],
  });
  assert.doesNotMatch(out, /Usage:/);
  assert.doesNotMatch(out, /Never:/);
});

test("formatCatalogue handles an empty registry", () => {
  const out = formatCatalogue({ items: [] });
  assert.match(out, /No Layout UI components/);
});

// --- fetchRegistryIndex: caching -------------------------------------------

test("fetchRegistryIndex caches by URL and only fetches once", async () => {
  _clearIndexCache();
  let calls = 0;
  const fetcher: IndexFetcher = async () => {
    calls++;
    return SAMPLE;
  };
  const base = "https://cache.test/r";
  const first = await fetchRegistryIndex(base, fetcher);
  const second = await fetchRegistryIndex(base, fetcher);
  assert.equal(calls, 1, "second call served from cache");
  assert.equal(first, second);
});

// --- handler: success + graceful failure -----------------------------------

test("handler returns a formatted catalogue on success", async () => {
  _clearIndexCache();
  const fetcher: IndexFetcher = async () => SAMPLE;
  const res = await handler(fetcher)();
  assert.equal(res.content[0].type, "text");
  assert.match(res.content[0].text, /# Layout UI components \(2\)/);
});

test("handler returns a helpful error string (not a throw) on fetch failure", async () => {
  _clearIndexCache();
  const fetcher: IndexFetcher = async () => {
    throw new Error("network down");
  };
  const res = await handler(fetcher)();
  assert.equal(res.content[0].type, "text");
  assert.match(res.content[0].text, /Could not reach the Layout UI registry/);
  assert.match(res.content[0].text, /network down/);
  assert.match(res.content[0].text, /add button/);
});
