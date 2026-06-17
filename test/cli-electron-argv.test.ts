/**
 * Regression: the CLI must parse node-style argv even when an Electron signature
 * is present. Layout Live's one-click "Set up editing" runs this CLI through the
 * Electron binary (ELECTRON_RUN_AS_NODE=1), so `process.versions.electron` is
 * set while argv is still node-shaped. With a bare `program.parse()`, commander
 * auto-detects `from: 'electron'`, slices only one arg, and treats the script
 * path as the command — failing with `unknown command '<…/cli.js>'`. bin/cli.ts
 * pins `{ from: "node" }` to prevent that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../dist/bin/cli.js");
const preload = path.resolve(here, "_fake-electron.mjs");

test(
  "parses node-style argv under an Electron signature (Live one-click setup)",
  { skip: existsSync(cli) ? false : "run `npm run build` first" },
  () => {
    // --import preloads the fake electron signature WITHOUT touching argv, so
    // the process mirrors Live's invocation. A bare parse() would throw here.
    const out = execFileSync(
      process.execPath,
      ["--import", url.pathToFileURL(preload).href, cli, "--version"],
      { encoding: "utf8" }
    );
    assert.match(out.trim(), /^\d+\.\d+\.\d+/);
  }
);
