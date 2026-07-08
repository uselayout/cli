/**
 * check-compliance MCP tool: the structured `format: "json"` output (with
 * per-issue nearest-token suggestions) and the unchanged default text output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as checkComplianceTool from "../src/mcp/tools/check-compliance.js";
import type { ComplianceIssue } from "../src/compliance/checker.js";
import type { Kit } from "../src/kit/types.js";

function makeKit(overrides: Partial<Kit> = {}): Kit {
  return {
    manifest: {
      name: "test-kit",
      version: "1.0.0",
      displayName: "Test Kit",
      description: "fixture",
      source: "test",
      tier: "free",
      tokenCount: 0,
      componentCount: 0,
      aesthetic: "test",
    },
    layoutMd: "# Test",
    sections: [],
    components: [],
    tokensCss: `:root { --color-primary: #6366f1; --space-4: 16px; }`,
    ...overrides,
  };
}

async function run(
  kit: Kit | null,
  args: { code: string; format?: "text" | "json" }
): Promise<string> {
  const result = await checkComplianceTool.handler(kit)(args);
  return result.content[0]!.text;
}

test("exports the standard tool module shape", () => {
  assert.equal(checkComplianceTool.name, "check-compliance");
  assert.equal(typeof checkComplianceTool.description, "string");
  assert.ok(checkComplianceTool.description.length > 20);
  assert.equal(typeof checkComplianceTool.inputSchema, "object");
  assert.equal(typeof checkComplianceTool.handler, "function");
  assert.equal(typeof checkComplianceTool.handler(null), "function");
});

test("registers on a real McpServer without throwing", () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  assert.doesNotThrow(() =>
    server.tool(
      checkComplianceTool.name,
      checkComplianceTool.description,
      checkComplianceTool.inputSchema,
      checkComplianceTool.handler(null)
    )
  );
});

test("default text output is unchanged (agents parse it)", async () => {
  const text = await run(makeKit(), { code: `const c = "#6467f2";` });
  assert.match(text, /^# Compliance Check: /);
  assert.match(text, /- \[WARNING\] hardcoded-colours \(line 1\): /);
});

test("format json returns { passed, summary, issues } with suggestions", async () => {
  const text = await run(makeKit(), {
    code: `const c = "#6467f2";`,
    format: "json",
  });
  const parsed = JSON.parse(text) as {
    passed: boolean;
    summary: string;
    issues: ComplianceIssue[];
  };
  assert.equal(parsed.passed, true); // warnings do not fail the check
  assert.match(parsed.summary, /warning/);
  assert.equal(parsed.issues.length, 1);
  const issue = parsed.issues[0]!;
  assert.equal(issue.ruleId, "hardcoded-colours");
  assert.equal(issue.severity, "warning");
  assert.equal(issue.line, 1);
  assert.equal(issue.value, "#6467f2");
  assert.deepEqual(issue.suggestion, {
    token: "--color-primary",
    value: "#6366f1",
  });
});

test("format json on clean code returns passed with empty issues", async () => {
  const text = await run(makeKit(), {
    code: `const x = "var(--color-primary)";`,
    format: "json",
  });
  const parsed = JSON.parse(text) as { passed: boolean; issues: unknown[] };
  assert.equal(parsed.passed, true);
  assert.deepEqual(parsed.issues, []);
});

test("no kit → setup message for both formats", async () => {
  assert.match(await run(null, { code: "x" }), /No design system kit found/);
  assert.match(
    await run(null, { code: "x", format: "json" }),
    /No design system kit found/
  );
});
