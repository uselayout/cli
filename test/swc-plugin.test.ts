/**
 * Unit tests for the SWC plugin path resolver + opt-in gate (src/plugins/next/swc.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resolveSwcPluginPath,
  swcTaggingEnabled,
  swcPluginEntry,
} from "../src/plugins/next/swc.js";

test("resolveSwcPluginPath returns the prebuilt wasm and it exists", () => {
  const p = resolveSwcPluginPath();
  assert.ok(p, "wasm path resolved");
  assert.match(p!, /assets\/layout-swc-plugin\.wasm$/);
  assert.ok(fs.existsSync(p!), "wasm file is present on disk");
});

test("swcTaggingEnabled follows LAYOUT_LIVE_SWC", () => {
  const prev = process.env.LAYOUT_LIVE_SWC;
  try {
    delete process.env.LAYOUT_LIVE_SWC;
    assert.equal(swcTaggingEnabled(), false, "off by default");
    process.env.LAYOUT_LIVE_SWC = "1";
    assert.equal(swcTaggingEnabled(), true, "on when set to 1");
    process.env.LAYOUT_LIVE_SWC = "true";
    assert.equal(swcTaggingEnabled(), false, "only '1' enables it");
  } finally {
    if (prev === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = prev;
  }
});

test("swcPluginEntry is null unless opted-in, then [wasm, {projectRoot, dev}]", () => {
  const prev = process.env.LAYOUT_LIVE_SWC;
  try {
    delete process.env.LAYOUT_LIVE_SWC;
    assert.equal(swcPluginEntry("/proj"), null, "null when off");
    process.env.LAYOUT_LIVE_SWC = "1";
    const entry = swcPluginEntry("/proj");
    assert.ok(entry, "entry when on");
    assert.match(entry![0], /layout-swc-plugin\.wasm$/);
    assert.deepEqual(entry![1], { projectRoot: "/proj", dev: true });
  } finally {
    if (prev === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = prev;
  }
});
