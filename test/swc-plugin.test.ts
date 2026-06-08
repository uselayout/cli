/**
 * Unit tests for the SWC plugin path resolver, opt-in modes, and the Next
 * version ABI guard (src/plugins/next/swc.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveSwcPluginPath,
  swcMode,
  swcTaggingEnabled,
  swcPluginEntry,
  resolveSwcDecision,
  nextSwcCore,
  nextAbiMatches,
  detectNextVersion,
  SWC_PLUGIN_SPECIFIER,
  WASM_TARGET_SWC_CORE,
} from "../src/plugins/next/swc.js";

/** Make a temp project root with node_modules/next@<version> (or none). */
async function projectWithNext(version: string | null): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "swc-guard-"));
  if (version) {
    const nm = path.join(dir, "node_modules", "next");
    await fsp.mkdir(nm, { recursive: true });
    await fsp.writeFile(
      path.join(nm, "package.json"),
      JSON.stringify({ name: "next", version })
    );
  }
  return dir;
}

function withEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env.LAYOUT_LIVE_SWC;
  try {
    if (value === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = value;
    fn();
  } finally {
    if (prev === undefined) delete process.env.LAYOUT_LIVE_SWC;
    else process.env.LAYOUT_LIVE_SWC = prev;
  }
}

test("resolveSwcPluginPath returns the prebuilt wasm and it exists", () => {
  const p = resolveSwcPluginPath();
  assert.ok(p, "wasm path resolved");
  assert.match(p!, /assets\/layout-swc-plugin\.wasm$/);
  assert.ok(fs.existsSync(p!), "wasm file is present on disk");
});

test("swcMode maps LAYOUT_LIVE_SWC: off / guarded / force", () => {
  withEnv(undefined, () => assert.equal(swcMode(), "off"));
  withEnv("0", () => assert.equal(swcMode(), "off"));
  withEnv("1", () => assert.equal(swcMode(), "guarded"));
  withEnv("force", () => assert.equal(swcMode(), "force"));
  withEnv("true", () => assert.equal(swcMode(), "off")); // only '1'/'force'
  withEnv("1", () => assert.equal(swcTaggingEnabled(), true));
  withEnv(undefined, () => assert.equal(swcTaggingEnabled(), false));
});

test("nextSwcCore reads the installed Next and maps to swc_core", async () => {
  const p155 = await projectWithNext("15.5.19");
  const p162 = await projectWithNext("16.2.7");
  const pNone = await projectWithNext(null);
  try {
    assert.equal(detectNextVersion(p155), "15.5.19");
    assert.equal(nextSwcCore(p155), 35);
    assert.equal(nextSwcCore(p162), 57);
    assert.equal(nextSwcCore(pNone), null); // no next installed
    assert.equal(nextAbiMatches(p162), true); // 57 === WASM_TARGET_SWC_CORE
    assert.equal(nextAbiMatches(p155), false); // 35 != 57 (skipped)
    assert.equal(WASM_TARGET_SWC_CORE, 57);
  } finally {
    for (const d of [p155, p162, pNone])
      await fsp.rm(d, { recursive: true, force: true });
  }
});

test("resolveSwcDecision: off unless opted-in", async () => {
  const p = await projectWithNext("15.5.19");
  try {
    withEnv(undefined, () => {
      const d = resolveSwcDecision(p);
      assert.equal(d.entry, null);
      assert.equal(d.reason, "off");
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("resolveSwcDecision guarded: injects on ABI match (Next 16.2.x)", async () => {
  const p = await projectWithNext("16.2.7");
  try {
    withEnv("1", () => {
      const d = resolveSwcDecision(p);
      assert.ok(d.entry, "entry present on match");
      assert.equal(d.entry![0], SWC_PLUGIN_SPECIFIER);
      assert.deepEqual(d.entry![1], { projectRoot: p, dev: true });
      assert.equal(d.reason, "abi-match");
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("resolveSwcDecision guarded: SKIPS on ABI mismatch (no hard fail)", async () => {
  const p = await projectWithNext("15.5.19"); // swc_core 35 != 57
  try {
    withEnv("1", () => {
      const d = resolveSwcDecision(p);
      assert.equal(d.entry, null, "no entry -> Next never loads a mismatched wasm");
      assert.match(d.reason, /^abi-mismatch:15\.5\.19:swc_core35$/);
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("resolveSwcDecision guarded: SKIPS on unknown Next version", async () => {
  const p = await projectWithNext(null);
  try {
    withEnv("1", () => {
      const d = resolveSwcDecision(p);
      assert.equal(d.entry, null);
      assert.match(d.reason, /^abi-unknown:/);
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("resolveSwcDecision force: injects regardless of Next version", async () => {
  const p = await projectWithNext("15.5.19"); // mismatched ABI; force bypasses
  try {
    withEnv("force", () => {
      const d = resolveSwcDecision(p);
      assert.ok(d.entry, "force bypasses the guard");
      assert.equal(d.entry![0], SWC_PLUGIN_SPECIFIER);
      assert.equal(d.reason, "forced");
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("swcPluginEntry wrapper mirrors resolveSwcDecision().entry", async () => {
  const p = await projectWithNext("16.2.3");
  try {
    withEnv("1", () => {
      const entry = swcPluginEntry(p);
      assert.ok(entry);
      assert.equal(entry![0], SWC_PLUGIN_SPECIFIER);
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});
