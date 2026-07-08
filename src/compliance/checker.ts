import type { Kit } from "../kit/types.js";
import { defaultRules } from "./rules.js";
import type { ComplianceRule } from "./rules.js";
import { suggestForIssue } from "./suggest.js";

export interface ComplianceIssue {
  ruleId: string;
  ruleName: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  /** 1-based column of the offending literal, when cheaply known. */
  column?: number;
  /** The offending literal itself (e.g. "#ff0000" or "13px"), for
   *  machine-driven quick fixes. Only set by rules that match a literal. */
  value?: string;
  /** Nearest design-system token for `value`, when one is close enough to
   *  be a confident replacement. `null` = looked, no confident match. */
  suggestion?: { token: string; value: string } | null;
}

export interface ComplianceResult {
  passed: boolean;
  issues: ComplianceIssue[];
  summary: string;
}

/**
 * Runs all compliance rules against the given code snippet and kit,
 * returning a result with collected issues and a pass/fail status.
 *
 * `passed` is true when there are no "error" severity issues.
 * Warnings and info-level issues do not cause failure.
 */
export function checkCompliance(
  code: string,
  kit: Kit,
  rules: ComplianceRule[] = defaultRules,
): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  for (const rule of rules) {
    const ruleIssues = rule.check(code, kit);
    issues.push(...ruleIssues);
  }

  // Attach nearest-token suggestions to issues that carry the offending
  // literal, so consumers (Live's quick fix, agents on JSON output) can
  // replace it with a design-system token in one step.
  for (const issue of issues) {
    if (issue.value !== undefined && issue.suggestion === undefined) {
      issue.suggestion = suggestForIssue(issue, kit);
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;
  const passed = errorCount === 0;

  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
  if (infoCount > 0) parts.push(`${infoCount} info`);

  const summary =
    parts.length === 0
      ? "No issues found — code is compliant."
      : `${passed ? "Passed" : "Failed"} with ${parts.join(", ")}.`;

  return { passed, issues, summary };
}
