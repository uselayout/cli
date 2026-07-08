import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import { checkCompliance } from "../../compliance/checker.js";
import type { ComplianceResult } from "../../compliance/checker.js";

export const name = "check-compliance";

export const description =
  "Validates a code snippet against the active design system's rules and tokens. " +
  "Returns a list of compliance issues found (hardcoded colours, wrong tokens, missing patterns). " +
  "Use this to verify UI code matches the design system before committing.";

export const inputSchema = {
  code: z.string().describe("The UI code snippet to check for design system compliance"),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe("Output format: 'text' for a human-readable report (default), 'json' for structured issues with nearest-token suggestions"),
};

export function handler(kit: Kit | null) {
  return async ({ code, format }: { code: string; format?: "text" | "json" }) => {
    if (!kit) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No design system kit found. Run `npx @layoutdesign/context init` to set one up.",
          },
        ],
      };
    }

    const result: ComplianceResult = checkCompliance(code, kit);

    if (format === "json") {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              passed: result.passed,
              summary: result.summary,
              issues: result.issues,
            }),
          },
        ],
      };
    }

    if (result.passed && result.issues.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "All checks passed. No design system compliance issues found.",
          },
        ],
      };
    }

    const lines = result.issues.map(
      (issue) =>
        `- [${issue.severity.toUpperCase()}] ${issue.ruleId}${issue.line ? ` (line ${issue.line})` : ""}: ${issue.message}`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `# Compliance Check: ${result.summary}\n\n${lines.join("\n")}`,
        },
      ],
    };
  };
}
