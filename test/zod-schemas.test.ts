/**
 * Zod input-schema validation for the new tools.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import * as getRecentVisualEdits from "../src/mcp/tools/get-recent-visual-edits.js";
import * as lockFile from "../src/mcp/tools/lock-file.js";
import * as unlockFile from "../src/mcp/tools/unlock-file.js";
import * as getSelectedElement from "../src/mcp/tools/get-selected-element.js";

test("get-selected-element accepts an empty object", () => {
  const schema = z.object(getSelectedElement.inputSchema);
  assert.deepEqual(schema.parse({}), {});
});

test("lock-file requires path and bounds ttl_seconds", () => {
  const schema = z.object(lockFile.inputSchema);

  const ok = schema.parse({ path: "src/App.tsx" });
  assert.equal(ok.path, "src/App.tsx");
  assert.equal(ok.ttl_seconds, 60, "ttl_seconds defaults to 60");

  assert.throws(() => schema.parse({}), "path is required");
  assert.throws(
    () => schema.parse({ path: "a.tsx", ttl_seconds: 0 }),
    "ttl_seconds must be positive"
  );
  assert.throws(
    () => schema.parse({ path: "a.tsx", ttl_seconds: 301 }),
    "ttl_seconds capped at 300"
  );
});

test("get-recent-visual-edits validates limit and since", () => {
  const schema = z.object(getRecentVisualEdits.inputSchema);

  const def = schema.parse({});
  assert.equal(def.limit, 20, "limit defaults to 20");

  assert.throws(() => schema.parse({ limit: 0 }), "limit must be positive");
  assert.throws(() => schema.parse({ limit: 101 }), "limit capped at 100");
  assert.throws(
    () => schema.parse({ since: "not-a-date" }),
    "since must be ISO-8601"
  );
  assert.doesNotThrow(() =>
    schema.parse({ since: "2026-05-16T14:32:01.000Z", file: "src/Hero.tsx" })
  );
});

test("unlock-file requires lock_id", () => {
  const schema = z.object(unlockFile.inputSchema);
  assert.equal(schema.parse({ lock_id: "abc" }).lock_id, "abc");
  assert.throws(() => schema.parse({}), "lock_id is required");
});
