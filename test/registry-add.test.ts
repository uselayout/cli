/**
 * Unit tests for the `add` command's pure logic: dependency resolution ordering,
 * import rewriting, and idempotent CSS var merging. The network is mocked via an
 * injected ItemFetcher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDependency,
  resolveItems,
  rewriteImports,
  injectBlock,
  resolveRegistryBase,
  destFileName,
  DEFAULT_REGISTRY,
  type RegistryItem,
  type ItemFetcher,
} from "../src/registry/index.js";

// --- classifyDependency -----------------------------------------------------

test("classifyDependency routes utils / @layout / url / bare correctly", () => {
  assert.deepEqual(classifyDependency("utils"), { kind: "utils" });
  assert.deepEqual(classifyDependency("@layout/button"), {
    kind: "name",
    name: "button",
  });
  assert.deepEqual(classifyDependency("https://x.dev/r/card.json"), {
    kind: "url",
    url: "https://x.dev/r/card.json",
  });
  assert.deepEqual(classifyDependency("input"), { kind: "name", name: "input" });
});

// --- resolveItems: ordering + de-dup ---------------------------------------

/** A fixture registry keyed by item name. */
function fixtureFetcher(items: Record<string, RegistryItem>): ItemFetcher {
  return async (ref) => {
    if (ref.kind === "url") return items[ref.value] ?? null;
    return items[ref.value] ?? null;
  };
}

test("resolveItems orders dependencies before dependents and flags utils", async () => {
  const items: Record<string, RegistryItem> = {
    button: { name: "button", registryDependencies: ["utils"] },
    "button-group": {
      name: "button-group",
      registryDependencies: ["utils", "@layout/button"],
    },
  };
  const res = await resolveItems(["button-group"], fixtureFetcher(items));
  assert.equal(res.needsUtils, true);
  assert.deepEqual(
    res.items.map((i) => i.name),
    ["button", "button-group"] // dependency first
  );
});

test("resolveItems de-duplicates shared transitive dependencies", async () => {
  const items: Record<string, RegistryItem> = {
    utils: { name: "utils" }, // unused (utils is special) but harmless
    button: { name: "button", registryDependencies: ["utils"] },
    input: { name: "input", registryDependencies: ["utils"] },
    "data-table": {
      name: "data-table",
      registryDependencies: ["utils", "@layout/button", "@layout/input"],
    },
  };
  const res = await resolveItems(["data-table"], fixtureFetcher(items));
  const names = res.items.map((i) => i.name);
  // button + input appear once each, before data-table.
  assert.deepEqual(names, ["button", "input", "data-table"]);
  assert.equal(new Set(names).size, names.length, "no duplicates");
});

test("resolveItems records unresolved bare deps instead of throwing", async () => {
  const items: Record<string, RegistryItem> = {
    widget: { name: "widget", registryDependencies: ["nonexistent"] },
  };
  const res = await resolveItems(["widget"], fixtureFetcher(items));
  assert.deepEqual(res.items.map((i) => i.name), ["widget"]);
  assert.deepEqual(res.unresolved, ["nonexistent"]);
});

test("resolveItems survives dependency cycles", async () => {
  const items: Record<string, RegistryItem> = {
    a: { name: "a", registryDependencies: ["@layout/b"] },
    b: { name: "b", registryDependencies: ["@layout/a"] },
  };
  const res = await resolveItems(["a"], fixtureFetcher(items));
  assert.equal(res.items.length, 2);
  assert.deepEqual(new Set(res.items.map((i) => i.name)), new Set(["a", "b"]));
});

// --- rewriteImports ---------------------------------------------------------

test("rewriteImports maps registry + utils imports to project aliases", () => {
  const src = [
    'import { cn } from "@/lib/utils";',
    'import { Button } from "@/registry/layout/button/button";',
    'import { Foo } from "@/registry/layout/data-table/data-table";',
  ].join("\n");
  const out = rewriteImports(src);
  assert.match(out, /from "@\/lib\/utils"/); // default utils alias unchanged
  assert.match(out, /from "@\/components\/ui\/button"/);
  assert.match(out, /from "@\/components\/ui\/data-table"/);
  assert.doesNotMatch(out, /@\/registry\/layout/);
});

test("rewriteImports honours custom aliases and leaves unrelated imports", () => {
  const src = [
    'import { cn } from "@/lib/utils";',
    'import { z } from "zod";',
    'import { Button } from "@/registry/layout/button/button";',
  ].join("\n");
  const out = rewriteImports(src, {
    componentAlias: "~/ui",
    utilsAlias: "~/lib/cn",
  });
  assert.match(out, /from "~\/lib\/cn"/);
  assert.match(out, /from "~\/ui\/button"/);
  assert.match(out, /from "zod"/); // untouched
});

// --- injectBlock: creation + idempotent merge ------------------------------

test("injectBlock creates a missing :root block", () => {
  const css = '@import "tailwindcss";\n';
  const out = injectBlock(css, ":root", { background: "white", radius: "0.5rem" });
  assert.match(out, /:root \{/);
  assert.match(out, /--background: white;/);
  assert.match(out, /--radius: 0\.5rem;/);
});

test("injectBlock merges into an existing block without duplicating", () => {
  const css = ":root {\n  --background: white;\n  --foreground: black;\n}\n";
  // Update --background, add --primary.
  const once = injectBlock(css, ":root", {
    background: "cream",
    primary: "navy",
  });
  const bgMatches = once.match(/--background:/g) ?? [];
  assert.equal(bgMatches.length, 1, "no duplicate --background");
  assert.match(once, /--background: cream;/); // replaced in place
  assert.match(once, /--foreground: black;/); // preserved
  assert.match(once, /--primary: navy;/); // appended

  // Idempotency: running again with the same vars is a no-op.
  const twice = injectBlock(once, ":root", { background: "cream", primary: "navy" });
  assert.equal(twice, once, "second identical merge changes nothing");
});

test("injectBlock handles the @theme inline selector", () => {
  const css = ":root { --x: 1; }\n";
  const out = injectBlock(css, "@theme inline", {
    "color-primary": "var(--primary)",
  });
  assert.match(out, /@theme inline \{/);
  assert.match(out, /--color-primary: var\(--primary\);/);
});

// --- misc helpers -----------------------------------------------------------

test("resolveRegistryBase honours flag > env > default and strips trailing slash", () => {
  const prev = process.env.LAYOUT_REGISTRY;
  delete process.env.LAYOUT_REGISTRY;
  assert.equal(resolveRegistryBase(), DEFAULT_REGISTRY);
  assert.equal(resolveRegistryBase("https://x.dev/r/"), "https://x.dev/r");
  process.env.LAYOUT_REGISTRY = "https://env.dev/r";
  assert.equal(resolveRegistryBase(), "https://env.dev/r");
  if (prev === undefined) delete process.env.LAYOUT_REGISTRY;
  else process.env.LAYOUT_REGISTRY = prev;
});

test("destFileName takes the basename of path or target", () => {
  assert.equal(
    destFileName({ path: "registry/layout/button/button.tsx" }),
    "button.tsx"
  );
  assert.equal(
    destFileName({ path: "registry/layout/x/x.tsx", target: "lib/thing.ts" }),
    "thing.ts"
  );
});
