/**
 * Kit → shadcn registry item generation: cssVars mapping, file targets,
 * stable serialisation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateKitRegistryItem,
  renderKitRegistryItem,
} from "../src/export/registry.js";
import { loadKitFromDir } from "../src/kit/loader.js";
import type { Kit } from "../src/kit/types.js";

const FIXTURE: Kit = {
  manifest: {
    name: "fixture-kit",
    version: "1.0.0",
    displayName: "Fixture Kit",
    description: "A tiny kit for tests",
    source: "test",
    tier: "free",
    tokenCount: 3,
    componentCount: 0,
    aesthetic: "Minimal",
  },
  layoutMd: "# Fixture\n",
  sections: [],
  components: [],
  tokensCss:
    ':root {\n  --fx-bg: #fff;\n  --fx-space: 8px;\n}\n[data-theme="dark"] {\n  --fx-bg: #000;\n}\n',
  tokensJson: '{"color":{"bg":{"$type":"color","$value":"#fff"}}}',
};

test("generateKitRegistryItem maps tokens.css into cssVars", () => {
  const item = generateKitRegistryItem(FIXTURE);
  assert.equal(item.name, "fixture-kit");
  assert.equal(item.type, "registry:base");
  assert.equal(item.title, "Fixture Kit");
  assert.deepEqual(item.cssVars.theme, { "fx-bg": "#fff", "fx-space": "8px" });
  assert.deepEqual(item.cssVars.dark, { "fx-bg": "#000" });
});

test("kit files install into .layout/ via registry:file targets", () => {
  const item = generateKitRegistryItem(FIXTURE);
  const targets = item.files.map((f) => f.target);
  assert.deepEqual(targets, [
    "~/.layout/layout.md",
    "~/.layout/tokens.css",
    "~/.layout/tokens.json",
    "~/.layout/kit.json",
  ]);
  for (const f of item.files) {
    assert.equal(f.type, "registry:file");
    assert.ok(f.content.length > 0, `${f.target} carries inline content`);
  }
  const kitJson = item.files.find((f) => f.target === "~/.layout/kit.json");
  assert.deepEqual(JSON.parse(kitJson!.content), FIXTURE.manifest);
});

test("renderKitRegistryItem is valid, stable JSON", () => {
  const rendered = renderKitRegistryItem(FIXTURE);
  assert.equal(rendered, renderKitRegistryItem(FIXTURE));
  const parsed = JSON.parse(rendered) as { $schema: string };
  assert.equal(parsed.$schema, "https://ui.shadcn.com/schema/registry-item.json");
  assert.ok(rendered.endsWith("\n"));
});

test("bundled kits produce non-empty registry items", () => {
  const kitsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "kits"
  );
  for (const name of ["linear-lite", "stripe-lite", "notion-lite"]) {
    const kit = loadKitFromDir(path.join(kitsDir, name));
    assert.ok(kit, `${name} loads`);
    const item = generateKitRegistryItem(kit);
    assert.equal(item.name, name);
    assert.ok(
      Object.keys(item.cssVars.theme ?? {}).length > 0,
      `${name} has theme cssVars`
    );
    assert.ok(item.files.length >= 3, `${name} ships its kit files`);
  }
});
