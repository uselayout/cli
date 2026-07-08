/**
 * update-tokens MCP tool: mode-scoped token replacement.
 *
 * The clobber bug this guards against: a var declared in BOTH :root and a
 * dark block ([data-theme="dark"] / .dark / @media prefers-color-scheme)
 * used to be overwritten globally, silently destroying dark themes. Updates
 * now default to mode "light" (base :root only); "dark" targets the dark
 * blocks; "all" restores the old global behaviour.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as updateTokens from "../src/mcp/tools/update-tokens.js";
import { parseCssBlocks, replaceTokenInCss } from "../src/mcp/tools/update-tokens.js";

/** Generated-shape tokens.css: :root + [data-theme="dark"] + @media dark. */
const CSS = `:root {
  /* === COLOURS === */
  --color-primary: #6366f1;
  --color-surface: #ffffff;
  --space-4: 16px;
}

[data-theme="dark"] {
  --color-primary: #818cf8;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #818cf8;
  }
}
`;

let dir = "";
let prevCwd = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "layout-upd-"));
  await fs.mkdir(path.join(dir, ".layout"), { recursive: true });
  await fs.writeFile(path.join(dir, ".layout", "tokens.css"), CSS);
  prevCwd = process.cwd();
  process.chdir(dir);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await fs.rm(dir, { recursive: true, force: true });
});

async function run(
  updates: Array<{ token: string; value: string; mode?: "light" | "dark" | "all" }>
): Promise<string> {
  const result = await updateTokens.handler()({ updates });
  return result.content[0]!.text;
}

async function readCss(): Promise<string> {
  return fs.readFile(path.join(dir, ".layout", "tokens.css"), "utf-8");
}

test("exports the standard tool module shape (mode is optional with a default)", () => {
  assert.equal(updateTokens.name, "update-tokens");
  assert.equal(typeof updateTokens.handler, "function");
  const item = updateTokens.inputSchema.updates.element;
  // Old callers ({ token, value } only) must still parse: mode defaults light.
  const parsed = item.safeParse({ token: "--x", value: "#fff" });
  assert.equal(parsed.success, true);
  assert.equal((parsed as { data: { mode: string } }).data.mode, "light");
  assert.equal(item.safeParse({ token: "--x", value: "#fff", mode: "sepia" }).success, false);
});

test("var in both blocks + mode light only changes :root", async () => {
  const text = await run([{ token: "--color-primary", value: "#ff0000", mode: "light" }]);
  assert.match(text, /--color-primary: #6366f1 → #ff0000/);
  const css = await readCss();
  assert.match(css, /:root \{\n  \/\* === COLOURS === \*\/\n  --color-primary: #ff0000;/);
  // Both dark declarations keep the dark value.
  assert.equal(css.match(/#818cf8/g)?.length, 2);
  assert.equal(css.includes("#6366f1"), false);
});

test("mode defaults to light when omitted (existing callers preserved)", async () => {
  await run([{ token: "--color-primary", value: "#ff0000" }]);
  const css = await readCss();
  assert.equal(css.match(/#818cf8/g)?.length, 2);
  assert.match(css, /--color-primary: #ff0000;/);
});

test("mode dark only changes the dark blocks (incl. the @media duplicate)", async () => {
  const text = await run([{ token: "--color-primary", value: "#a5b4fc", mode: "dark" }]);
  assert.match(text, /--color-primary: #818cf8 → #a5b4fc/);
  assert.match(text, /tokens\.css \(dark blocks\)/);
  const css = await readCss();
  // Base :root untouched.
  assert.match(css, /--color-primary: #6366f1;/);
  // Both the [data-theme="dark"] block AND the @media-wrapped :root updated.
  assert.equal(css.match(/#a5b4fc/g)?.length, 2);
  assert.equal(css.includes("#818cf8"), false);
});

test("mode all changes both light and dark blocks", async () => {
  await run([{ token: "--color-primary", value: "#000000", mode: "all" }]);
  const css = await readCss();
  assert.equal(css.match(/--color-primary: #000000;/g)?.length, 3);
  assert.equal(css.includes("#6366f1"), false);
  assert.equal(css.includes("#818cf8"), false);
});

test("var only in :root with mode light updates it", async () => {
  await run([{ token: "--color-surface", value: "#f8fafc", mode: "light" }]);
  const css = await readCss();
  assert.match(css, /--color-surface: #f8fafc;/);
});

test("var only in :root with mode dark is a visible skip, file untouched", async () => {
  const text = await run([{ token: "--color-surface", value: "#111", mode: "dark" }]);
  assert.match(text, /Token "--color-surface" \(dark\) not found in tokens\.css/);
  assert.equal(await readCss(), CSS);
});

test("missing var error unchanged", async () => {
  const text = await run([{ token: "--does-not-exist", value: "#111" }]);
  assert.match(text, /Token "--does-not-exist" not found in tokens\.css/);
  assert.equal(await readCss(), CSS);
});

test("a token name never matches a longer var's suffix", async () => {
  await fs.writeFile(
    path.join(dir, ".layout", "tokens.css"),
    ":root {\n  --primary: #111111;\n  --color-primary: #222222;\n}\n"
  );
  await run([{ token: "--primary", value: "#333333" }]);
  const css = await readCss();
  assert.match(css, /--primary: #333333;/);
  assert.match(css, /--color-primary: #222222;/);
});

test("dark .dark-class blocks are recognised as dark", async () => {
  await fs.writeFile(
    path.join(dir, ".layout", "tokens.css"),
    ":root {\n  --bg: #fff;\n}\n\n.dark {\n  --bg: #000;\n}\n"
  );
  await run([{ token: "--bg", value: "#111", mode: "dark" }]);
  const css = await readCss();
  assert.match(css, /:root \{\n  --bg: #fff;/);
  assert.match(css, /\.dark \{\n  --bg: #111;/);
});

test("tokens.json: dark update prefers the $extensions.mode dark entry", async () => {
  await fs.writeFile(
    path.join(dir, ".layout", "tokens.json"),
    JSON.stringify({
      color: {
        primary: { $type: "color", $value: "#6366f1" },
        "primary-dark": {
          $type: "color",
          $value: "#818cf8",
          $extensions: { mode: "dark" },
        },
      },
    })
  );
  const text = await run([{ token: "--color-primary", value: "#a5b4fc", mode: "dark" }]);
  assert.match(text, /tokens\.json \(color\.primary-dark\)/);
  const json = JSON.parse(
    await fs.readFile(path.join(dir, ".layout", "tokens.json"), "utf-8")
  ) as { color: { primary: { $value: string }; "primary-dark": { $value: string } } };
  assert.equal(json.color["primary-dark"].$value, "#a5b4fc");
  assert.equal(json.color.primary.$value, "#6366f1");
});

test("tokens.json without a mode dimension still matches by old value", async () => {
  await fs.writeFile(
    path.join(dir, ".layout", "tokens.json"),
    JSON.stringify({ color: { primary: { $type: "color", $value: "#6366f1" } } })
  );
  const text = await run([{ token: "--color-primary", value: "#ff0000", mode: "light" }]);
  assert.match(text, /tokens\.json \(color\.primary\)/);
});

test("layout.md is synced for light but never for dark", async () => {
  const md = "Primary colour is #6366f1 (dark variant #818cf8).\n";
  await fs.writeFile(path.join(dir, ".layout", "layout.md"), md);

  await run([{ token: "--color-primary", value: "#a5b4fc", mode: "dark" }]);
  assert.equal(await fs.readFile(path.join(dir, ".layout", "layout.md"), "utf-8"), md);

  const text = await run([{ token: "--color-primary", value: "#ff0000", mode: "light" }]);
  assert.match(text, /layout\.md \(1 occurrence\)/);
  const after = await fs.readFile(path.join(dir, ".layout", "layout.md"), "utf-8");
  assert.match(after, /#ff0000/);
  assert.match(after, /#818cf8/); // the dark mention untouched
});

test("parseCssBlocks classifies nested @media dark and base blocks", () => {
  const blocks = parseCssBlocks(CSS);
  assert.equal(blocks.length, 3);
  assert.deepEqual(
    blocks.map((b) => b.dark),
    [false, true, true]
  );
});

test("replaceTokenInCss reports unchanged when the value already matches", () => {
  const res = replaceTokenInCss(CSS, "--color-primary", "#6366F1", "light");
  assert.deepEqual(res, { ok: false, reason: "unchanged", oldValue: "#6366f1" });
});
