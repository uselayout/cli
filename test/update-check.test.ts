/**
 * Update-notifier: version comparison + the throttled, fail-silent check.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareVersions, checkForUpdate } from "../src/update-check.js";

const CACHE_FILE = path.join(os.tmpdir(), "layout-context-update.json");

let prevNoCheck: string | undefined;
let prevCi: string | undefined;

beforeEach(() => {
  prevNoCheck = process.env.LAYOUT_NO_UPDATE_CHECK;
  prevCi = process.env.CI;
  delete process.env.LAYOUT_NO_UPDATE_CHECK;
  delete process.env.CI;
  fs.rmSync(CACHE_FILE, { force: true });
});

afterEach(() => {
  if (prevNoCheck === undefined) delete process.env.LAYOUT_NO_UPDATE_CHECK;
  else process.env.LAYOUT_NO_UPDATE_CHECK = prevNoCheck;
  if (prevCi === undefined) delete process.env.CI;
  else process.env.CI = prevCi;
  fs.rmSync(CACHE_FILE, { force: true });
});

test("compareVersions orders by major.minor.patch, ignoring prerelease", () => {
  assert.equal(compareVersions("0.15.2", "0.15.1") > 0, true);
  assert.equal(compareVersions("0.15.1", "0.15.2") < 0, true);
  assert.equal(compareVersions("1.0.0", "0.99.99") > 0, true);
  assert.equal(compareVersions("0.15.1", "0.15.1"), 0);
  assert.equal(compareVersions("0.16.0", "0.15.9") > 0, true);
  assert.equal(compareVersions("0.15.2-beta.1", "0.15.1"), 1);
});

test("returns update info from a FRESH cache without hitting the network", async () => {
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ checkedAt: Date.now(), latest: "9.9.9" })
  );
  const info = await checkForUpdate("0.15.1");
  assert.deepEqual(info, { current: "0.15.1", latest: "9.9.9" });
});

test("returns null when the fresh-cached latest is not newer", async () => {
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ checkedAt: Date.now(), latest: "0.15.1" })
  );
  assert.equal(await checkForUpdate("0.15.1"), null);
});

test("opt-out via LAYOUT_NO_UPDATE_CHECK returns null without reading cache", async () => {
  process.env.LAYOUT_NO_UPDATE_CHECK = "1";
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ checkedAt: Date.now(), latest: "9.9.9" })
  );
  assert.equal(await checkForUpdate("0.15.1"), null);
});
