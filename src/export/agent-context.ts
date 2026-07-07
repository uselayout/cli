/**
 * Kit-specific agent context generators.
 *
 * One body of design-system context, emitted in the shapes each agent
 * ecosystem expects:
 *   - AGENTS.md / CLAUDE.md managed block (merge-or-create)
 *   - .cursor/rules/*.mdc rule file (frontmatter + body)
 *   - Codex skill (frontmatter-less SKILL.md, modelled on skills/layout-md)
 *
 * Used by both `export` and `install` so the two never drift.
 */
import type { Kit } from "../kit/types.js";
import { makeManagedBlock, type ManagedBlock } from "./managed-block.js";
import { parseCssVariables } from "./kit-tokens.js";

export const DESIGN_SYSTEM_BLOCK_NAME = "layout design system";

const MCP_COMMAND = "npx -y @layoutdesign/context serve";
const MCP_TOOL_SUMMARY =
  "`get-design-system`, `get-tokens`, `get-component`, `list-components`, `check-compliance`";

/**
 * A fenced CSS block listing the kit's root-mode tokens, truncated to keep
 * agent files small. Returns "" when the kit has no tokens.css.
 */
export function tokenQuickReference(kit: Kit, limit = 24): string {
  if (!kit.tokensCss) return "";
  const rootVars = parseCssVariables(kit.tokensCss).filter((v) => !v.mode);
  if (rootVars.length === 0) return "";
  const shown = rootVars.slice(0, limit);
  const lines = shown.map((v) => `--${v.name}: ${v.value};`);
  if (rootVars.length > shown.length) {
    lines.push(
      `/* ...and ${rootVars.length - shown.length} more in .layout/tokens.css */`
    );
  }
  return "```css\n" + lines.join("\n") + "\n```";
}

/** The shared design-system context body (no managed-block markers). */
export function generateAgentContextBody(kit: Kit): string {
  const { displayName, description, aesthetic } = kit.manifest;
  const quickRef = tokenQuickReference(kit);

  const parts: string[] = [];
  parts.push(`## Design system: ${displayName}`);
  parts.push(
    [
      `This project uses the ${displayName} design system` +
        (description ? ` (${description.replace(/\.$/, "")})` : "") +
        `, served from \`.layout/\`.`,
      `Read \`.layout/layout.md\` before writing any UI code.`,
    ].join(" ")
  );

  if (quickRef) {
    parts.push(`### Token quick reference\n\n${quickRef}`);
  }

  const rules = [
    "- Use the CSS custom properties from `.layout/tokens.css`. Never hardcode colours, spacing, or radii.",
    "- Follow the component specs and anti-pattern rules in `.layout/layout.md`.",
  ];
  if (aesthetic) rules.push(`- Aesthetic: ${aesthetic}.`);
  parts.push(`### Rules\n\n${rules.join("\n")}`);

  parts.push(
    [
      "### Full context via MCP",
      "",
      "For queryable, always-current design-system context, run the Layout MCP server:",
      "",
      "```bash",
      MCP_COMMAND,
      "```",
      "",
      `Key tools: ${MCP_TOOL_SUMMARY}. Validate generated UI with \`check-compliance\` before finishing.`,
    ].join("\n")
  );

  return parts.join("\n\n");
}

/** The design-system context wrapped in managed-block markers. */
export function generateAgentContextBlock(kit: Kit): ManagedBlock {
  return makeManagedBlock(DESIGN_SYSTEM_BLOCK_NAME, generateAgentContextBody(kit));
}

/** A Cursor project rule (.cursor/rules/*.mdc) carrying the same context. */
export function generateCursorRuleMdc(kit: Kit): string {
  const description = `${kit.manifest.displayName} design system context. Apply when writing or editing UI code.`;
  return [
    "---",
    `description: ${description}`,
    "alwaysApply: true",
    "---",
    "",
    generateAgentContextBody(kit),
    "",
  ].join("\n");
}

/**
 * A kit-specific Codex skill: frontmatter-less title, purpose, invocation
 * guidance, token quick reference, and a pointer to the MCP server for full
 * context. Modelled on skills/layout-md/SKILL.md.
 */
export function generateCodexSkill(kit: Kit): string {
  const { displayName, description } = kit.manifest;
  const quickRef = tokenQuickReference(kit);

  const parts: string[] = [];
  parts.push(`# ${displayName} design system`);

  parts.push(
    [
      "## Purpose",
      "",
      `Give the agent the project's design-system context so generated UI stays on-brand.`,
      `The ${displayName} kit${description ? ` (${description.replace(/\.$/, "")})` : ""} lives in \`.layout/\`:`,
      "`layout.md` (full specification), `tokens.css` (CSS custom properties), and `tokens.json` (W3C DTCG).",
    ].join("\n")
  );

  parts.push(
    [
      "## When to invoke",
      "",
      "- Creating or editing UI components, pages, or styles",
      "- Reviewing UI code for design-system compliance",
      "- Answering questions about colours, typography, spacing, or components",
    ].join("\n")
  );

  if (quickRef) {
    parts.push(`## Token quick reference\n\n${quickRef}`);
  }

  parts.push(
    [
      "## Full context",
      "",
      "Read `.layout/layout.md` for the complete specification, component specs, and anti-pattern rules.",
      "Use tokens, never hardcoded values.",
      "",
      "For queryable context, run the Layout MCP server:",
      "",
      "```bash",
      MCP_COMMAND,
      "```",
      "",
      `Key tools: ${MCP_TOOL_SUMMARY}.`,
    ].join("\n")
  );

  return parts.join("\n\n") + "\n";
}
