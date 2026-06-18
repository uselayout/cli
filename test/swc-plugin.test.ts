/**
 * Unit tests for multi-ABI wasm resolution, opt-in modes (default guarded-ON),
 * and the Next-version ABI auto-pick (src/plugins/next/swc.ts).
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
  nextAbiSupported,
  detectNextVersion,
  swcPluginSpecifier,
  SHIPPED_SWC_CORES,
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

test("ships a wasm for every supported swc_core ABI (90 + 35 + 57)", () => {
  assert.deepEqual([...SHIPPED_SWC_CORES], [90, 35, 57]);
  for (const swc of SHIPPED_SWC_CORES) {
    const p = resolveSwcPluginPath(swc);
    assert.ok(p, `wasm for swc_core ${swc} resolved`);
    assert.match(p!, new RegExp(`layout-swc-plugin-${swc}\\.wasm$`));
    assert.ok(fs.existsSync(p!), `wasm ${swc} present on disk`);
  }
});

test("swcMode defaults to guarded-ON; 0/off disables; force bypasses", () => {
  withEnv(undefined, () => assert.equal(swcMode(), "guarded")); // default ON
  withEnv("1", () => assert.equal(swcMode(), "guarded"));
  withEnv("0", () => assert.equal(swcMode(), "off"));
  withEnv("off", () => assert.equal(swcMode(), "off"));
  withEnv("force", () => assert.equal(swcMode(), "force"));
  withEnv(undefined, () => assert.equal(swcTaggingEnabled(), true));
  withEnv("0", () => assert.equal(swcTaggingEnabled(), false));
});

test("nextSwcCore maps the installed Next; nextAbiSupported gates on shipped ABIs", async () => {
  const p155 = await projectWithNext("15.5.19");
  const p162 = await projectWithNext("16.2.7");
  const p160 = await projectWithNext("16.0.3"); // swc_core 45 — not shipped
  const pNone = await projectWithNext(null);
  try {
    assert.equal(nextSwcCore(p155), 35);
    assert.equal(nextSwcCore(p162), 57);
    assert.equal(nextSwcCore(p160), 45);
    assert.equal(nextSwcCore(pNone), null);
    assert.equal(nextAbiSupported(p155), true); // 35 shipped
    assert.equal(nextAbiSupported(p162), true); // 57 shipped
    assert.equal(nextAbiSupported(p160), false); // 45 not shipped
    assert.equal(detectNextVersion(p162), "16.2.7");
  } finally {
    for (const d of [p155, p162, p160, pNone])
      await fsp.rm(d, { recursive: true, force: true });
  }
});

test("default (unset): auto-picks the matching wasm per Next version", async () => {
  const p155 = await projectWithNext("15.5.2");
  const p162 = await projectWithNext("16.2.7");
  try {
    withEnv(undefined, () => {
      const d155 = resolveSwcDecision(p155);
      assert.equal(d155.entry![0], swcPluginSpecifier(35));
      assert.equal(d155.reason, "abi-match:35");

      const d162 = resolveSwcDecision(p162);
      assert.equal(d162.entry![0], swcPluginSpecifier(57));
      assert.equal(d162.reason, "abi-match:57");
      assert.deepEqual(d162.entry![1], { projectRoot: p162, dev: true });
    });
  } finally {
    await fsp.rm(p155, { recursive: true, force: true });
    await fsp.rm(p162, { recursive: true, force: true });
  }
});

test("LAYOUT_LIVE_SWC=0 disables even on a supported Next", async () => {
  const p = await projectWithNext("16.2.7");
  try {
    withEnv("0", () => {
      const d = resolveSwcDecision(p);
      assert.equal(d.entry, null);
      assert.equal(d.reason, "off");
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("guarded: SKIPS an unshipped Next ABI (no hard fail)", async () => {
  const p = await projectWithNext("16.0.3"); // swc_core 45 — no wasm
  try {
    withEnv(undefined, () => {
      const d = resolveSwcDecision(p);
      assert.equal(d.entry, null, "no entry → Next never loads a mismatched wasm");
      assert.match(d.reason, /^abi-unsupported:16\.0\.3:swc_core45$/);
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("guarded: SKIPS an unknown Next version", async () => {
  const p = await projectWithNext(null);
  try {
    withEnv(undefined, () => {
      const d = resolveSwcDecision(p);
      assert.equal(d.entry, null);
      assert.match(d.reason, /^abi-unknown:/);
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("force: injects the newest shipped ABI on an unshipped Next", async () => {
  const p = await projectWithNext("16.0.3"); // 45 not shipped
  try {
    withEnv("force", () => {
      const d = resolveSwcDecision(p);
      assert.ok(d.entry, "force injects anyway");
      assert.equal(d.entry![0], swcPluginSpecifier(57)); // newest shipped
      assert.equal(d.reason, "forced:57");
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});

test("swcPluginEntry wrapper mirrors resolveSwcDecision().entry", async () => {
  const p = await projectWithNext("15.5.7");
  try {
    withEnv(undefined, () => {
      const entry = swcPluginEntry(p);
      assert.ok(entry);
      assert.equal(entry![0], swcPluginSpecifier(35));
    });
  } finally {
    await fsp.rm(p, { recursive: true, force: true });
  }
});
