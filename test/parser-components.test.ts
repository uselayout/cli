/**
 * parseComponents name extraction.
 *
 * Guards the heading-marker strip: the first entry of a "## Components"
 * section, and every entry loaded from a standalone components/*.md file
 * (the loader wraps each file as "## Components\n### <file>"), used to keep
 * its leading "### " in the parsed name, breaking get-component lookups.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseComponents } from "../src/kit/parser.js";

test("strips the leading heading marker from a standalone component file", () => {
  // Mirrors loader.ts: parseComponents(`## Components\n### ${fileContent}`)
  const fileContent = [
    "PrimaryButton",
    "",
    "Filled accent button.",
    "",
    "- `--color-primary`",
    "",
    "```tsx",
    "export const PrimaryButton = () => <button style={{ background: 'var(--color-primary)' }}>Go</button>;",
    "```",
    "",
  ].join("\n");

  const parsed = parseComponents(`## Components\n### ${fileContent}`);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.name, "PrimaryButton");
  assert.equal(parsed[0]?.description, "Filled accent button.");
  assert.deepEqual(parsed[0]?.tokens, ["--color-primary"]);
  assert.match(parsed[0]?.codeExample ?? "", /PrimaryButton/);
});

test("parses every component name cleanly in a multi-entry section", () => {
  const md = [
    "## Components",
    "### Button",
    "A button.",
    "```tsx",
    "export const Button = () => <button>x</button>;",
    "```",
    "### Card",
    "A card.",
    "```tsx",
    "export const Card = () => <div>x</div>;",
    "```",
  ].join("\n");

  const parsed = parseComponents(md);
  const names = parsed.map((c) => c.name);

  // Pre-fix the first name was "### Button".
  assert.deepEqual(names, ["Button", "Card"]);
});
