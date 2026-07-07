/**
 * Tool registration + module-shape contract for the Live tools.
 *
 * Asserts each module exports the same surface as the other tools
 * (name / description / inputSchema / handler) and that they all register on
 * a real McpServer without throwing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import * as getSelectedElement from "../src/mcp/tools/get-selected-element.js";
import * as getRecentVisualEdits from "../src/mcp/tools/get-recent-visual-edits.js";
import * as getPendingRequests from "../src/mcp/tools/get-pending-requests.js";
import * as markRequest from "../src/mcp/tools/mark-request.js";
import * as lockFile from "../src/mcp/tools/lock-file.js";
import * as unlockFile from "../src/mcp/tools/unlock-file.js";

const modules = [
  { mod: getSelectedElement, expected: "get-selected-element" },
  { mod: getRecentVisualEdits, expected: "get-recent-visual-edits" },
  { mod: getPendingRequests, expected: "get-pending-requests" },
  { mod: markRequest, expected: "mark-request" },
  { mod: lockFile, expected: "lock-file" },
  { mod: unlockFile, expected: "unlock-file" },
];

test("each new tool exports name/description/inputSchema/handler", () => {
  for (const { mod, expected } of modules) {
    assert.equal(mod.name, expected, `${expected}: kebab-case name`);
    assert.equal(typeof mod.description, "string");
    assert.ok(mod.description.length > 20, `${expected}: has a real description`);
    assert.equal(typeof mod.inputSchema, "object");
    assert.equal(typeof mod.handler, "function");
    assert.equal(
      typeof mod.handler(),
      "function",
      `${expected}: handler() returns the async tool fn`
    );
  }
});

test("all Live tools register on a real McpServer without throwing", () => {
  const server = new McpServer({ name: "test", version: "0.7.0" });
  assert.doesNotThrow(() => {
    for (const { mod } of modules) {
      server.tool(mod.name, mod.description, mod.inputSchema, mod.handler());
    }
  });
});

test("server.ts registers the Live tools alongside the existing ones", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/mcp/server.ts", import.meta.url), "utf8")
  );
  for (const { expected } of modules) {
    assert.ok(
      src.includes(expected.replace(/-/g, "")) ||
        src.includes(expected),
      `server.ts references ${expected}`
    );
  }
  // Existing registrations must remain (spot-check a few).
  for (const existing of ["get-tokens", "check-compliance", "check-setup", "scan-project"]) {
    assert.ok(src.includes(existing), `server.ts still registers ${existing}`);
  }
});
