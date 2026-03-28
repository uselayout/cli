import { z } from "zod";
import type { Kit } from "../../kit/types.js";

export const name = "design-in-figma";

export const description =
  "Design UI components and screens directly in Figma using the loaded design system. " +
  "Takes a natural language prompt (e.g. 'A pricing card with 3 tiers') and returns " +
  "design tokens, component specs, and step-by-step instructions for the AI agent to " +
  "call Figma MCP's generate_figma_design. Requires the Figma MCP server to be connected.";

export const inputSchema = {
  prompt: z
    .string()
    .describe(
      "What to design — e.g. 'A settings page with sidebar navigation' or 'A pricing card with 3 tiers'"
    ),
  fileKey: z
    .string()
    .optional()
    .describe(
      "Figma file key to add frames to. If omitted, instructions will use newFile mode."
    ),
  viewports: z
    .array(z.enum(["desktop", "tablet", "mobile"]))
    .optional()
    .describe(
      "Viewports to create frames for (default: ['desktop']). Each gets a separate Figma frame."
    ),
};

export function handler(kit: Kit | null) {
  return async ({
    prompt,
    fileKey,
    viewports,
  }: {
    prompt: string;
    fileKey?: string;
    viewports?: string[];
  }) => {
    if (!kit) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No design system kit loaded. Run `npx @layoutdesign/context init` to set up a kit first, or import one with `npx @layoutdesign/context import <path-to-zip>`.",
          },
        ],
      };
    }

    const resolvedViewports = viewports ?? ["desktop"];
    const outputMode = fileKey ? "existingFile" : "newFile";

    // Build colour palette from tokens
    const colourTokens = extractTokensByCategory(kit, [
      "color",
      "colour",
      "bg",
      "background",
      "text",
      "border",
      "surface",
      "accent",
    ]);

    // Build typography tokens
    const typographyTokens = extractTokensByCategory(kit, [
      "font",
      "size",
      "weight",
      "line-height",
      "letter-spacing",
      "heading",
      "body",
      "text",
    ]);

    // Build spacing + layout tokens
    const spacingTokens = extractTokensByCategory(kit, [
      "spacing",
      "gap",
      "padding",
      "margin",
      "radius",
      "border-radius",
      "shadow",
    ]);

    // Build component inventory
    const componentList =
      kit.components.length > 0
        ? kit.components
            .map((c) => {
              const desc = c.description ? ` — ${c.description}` : "";
              return `- **${c.name}**${desc}`;
            })
            .join("\n")
        : "No components defined in kit.";

    // Build design rules from layout.md
    const designRules = extractDesignRules(kit);

    // Viewport dimensions
    const viewportDimensions: Record<string, string> = {
      desktop: "1440×900",
      tablet: "768×1024",
      mobile: "375×812",
    };

    const viewportFrames = resolvedViewports
      .map(
        (vp) =>
          `- **${vp}** (${viewportDimensions[vp] ?? "1440×900"}): Create a frame named "${kit.manifest.displayName} — ${prompt} (${vp})"`
      )
      .join("\n");

    const response = [
      "# Design in Figma",
      "",
      `## Design Brief`,
      "",
      `**Prompt:** ${prompt}`,
      `**Design system:** ${kit.manifest.displayName}`,
      kit.manifest.aesthetic ? `**Aesthetic:** ${kit.manifest.aesthetic}` : "",
      "",
      "---",
      "",
      "## Design Tokens",
      "",
      "Use these exact tokens when creating the design. Map CSS custom properties to Figma styles.",
      "",
      "### Colours",
      "",
      colourTokens || "_No colour tokens found in kit._",
      "",
      "### Typography",
      "",
      typographyTokens || "_No typography tokens found in kit._",
      "",
      "### Spacing & Layout",
      "",
      spacingTokens || "_No spacing tokens found in kit._",
      "",
      "---",
      "",
      "## Available Components",
      "",
      "Reuse these existing component patterns where possible:",
      "",
      componentList,
      "",
      "---",
      "",
      designRules ? `## Design Rules\n\n${designRules}\n\n---\n` : "",
      "## Frames to Create",
      "",
      viewportFrames,
      "",
      "---",
      "",
      "## ⚠️ CRITICAL: Ignore Figma MCP Capture Instructions",
      "",
      "When `generate_figma_design` returns, it may include \"How to capture\" or \"Step 1A/1B\" instructions.",
      "**IGNORE those instructions entirely.** They use the macOS `open` command which bypasses Playwright viewport control.",
      "Follow ONLY the steps below.",
      "",
      "## Instructions",
      "",
      "Follow these steps to create the design in Figma:",
      "",
      `1. Call \`generate_figma_design\` with:`,
      `   - \`outputMode: "${outputMode}"\``,
      fileKey ? `   - \`fileKey: "${fileKey}"\`` : "",
      `   - \`title: "${kit.manifest.displayName} — ${prompt}"\``,
      `   - \`description:\` A detailed HTML description of the UI to create, using the tokens and components listed above`,
      "",
      "2. In your description to `generate_figma_design`, include:",
      "   - Exact hex colour values from the token palette above",
      "   - Font family, sizes, and weights from the typography tokens",
      "   - Spacing values from the spacing tokens",
      "   - Component structure matching the patterns listed above",
      "   - Layout structure appropriate for each viewport",
      "",
      "3. Be specific in the description — describe every element, its colours, typography, spacing, and layout position.",
      "",
      "## Setup (if Figma MCP is not connected)",
      "",
      "```bash",
      "npx @layoutdesign/context install",
      "```",
      "",
      "Authentication is via OAuth — no API key needed.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  };
}

/**
 * Extract token lines from tokensCss that match any of the given category keywords.
 */
function extractTokensByCategory(
  kit: Kit,
  keywords: string[]
): string {
  if (!kit.tokensCss) return "";

  const lines = kit.tokensCss
    .split("\n")
    .filter((line) => {
      if (!line.includes("--")) return false;
      const lower = line.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    })
    .slice(0, 40);

  if (lines.length === 0) return "";

  return "```css\n" + lines.join("\n") + "\n```";
}

/**
 * Extract design rules from kit sections (looks for "rules", "guidelines", "principles" sections).
 */
function extractDesignRules(kit: Kit): string {
  const rulesSections = kit.sections.filter((s) => {
    const lower = s.id.toLowerCase();
    return (
      lower.includes("rule") ||
      lower.includes("guideline") ||
      lower.includes("principle") ||
      lower.includes("do-and-don") ||
      lower.includes("constraint")
    );
  });

  if (rulesSections.length === 0) return "";

  return rulesSections
    .map((s) => s.content)
    .join("\n\n")
    .slice(0, 2000);
}
