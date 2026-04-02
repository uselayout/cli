import { z } from "zod";
import type { Kit } from "../../kit/types.js";

export const name = "push-tokens-to-figma";

export const description =
  "Push design system tokens to Figma as native variables and styles using Figma MCP's use_figma tool. " +
  "Creates a variable collection with colour, spacing, and radius variables, plus text and effect styles. " +
  "Requires the Figma MCP server to be connected.";

export const inputSchema = {
  fileKey: z
    .string()
    .optional()
    .describe(
      "Figma file key to push tokens into. If omitted, instructions will create a new file."
    ),
};

export function handler(kit: Kit | null) {
  return async ({ fileKey }: { fileKey?: string }) => {
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

    if (!kit.tokensCss) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No CSS tokens found in kit. Extract tokens from a Figma file or website first.",
          },
        ],
      };
    }

    // Parse CSS custom properties into categories
    const colourTokens = parseTokens(kit.tokensCss, [
      "color", "colour", "bg", "background", "text", "border",
      "surface", "accent", "primary", "secondary", "error", "warning", "success",
    ]);

    const spacingTokens = parseTokens(kit.tokensCss, [
      "spacing", "space", "gap", "padding", "margin",
    ]);

    const radiusTokens = parseTokens(kit.tokensCss, [
      "radius", "border-radius", "rounded",
    ]);

    const shadowTokens = parseTokens(kit.tokensCss, [
      "shadow", "elevation", "effect",
    ]);

    const typographyTokens = parseTokens(kit.tokensCss, [
      "font", "size", "weight", "line-height", "letter-spacing",
      "heading", "body", "display", "caption", "label",
    ]);

    const allTokenLines = kit.tokensCss
      .split("\n")
      .filter((line) => line.includes("--") && line.includes(":"))
      .map((line) => line.trim());

    const totalTokenCount = allTokenLines.length;

    const response = [
      "# Push Tokens to Figma",
      "",
      `**Design system:** ${kit.manifest.displayName}`,
      `**Total tokens:** ${totalTokenCount}`,
      "",
      "---",
      "",
      "## Token Inventory",
      "",
      colourTokens.length > 0 ? `### Colours (${colourTokens.length} tokens)\n\n${formatTokens(colourTokens)}` : "",
      "",
      spacingTokens.length > 0 ? `### Spacing (${spacingTokens.length} tokens)\n\n${formatTokens(spacingTokens)}` : "",
      "",
      radiusTokens.length > 0 ? `### Radius (${radiusTokens.length} tokens)\n\n${formatTokens(radiusTokens)}` : "",
      "",
      shadowTokens.length > 0 ? `### Shadows (${shadowTokens.length} tokens)\n\n${formatTokens(shadowTokens)}` : "",
      "",
      typographyTokens.length > 0 ? `### Typography (${typographyTokens.length} tokens)\n\n${formatTokens(typographyTokens)}` : "",
      "",
      "---",
      "",
      "## Instructions",
      "",
      "Use Figma MCP's `use_figma` tool to create these tokens as native Figma variables and styles.",
      "",
      "**Recommended:** Invoke this with the `figma-use` skill for best results.",
      "",
      `1. Call \`use_figma\` to create a variable collection called "${kit.manifest.displayName} Tokens":`,
      fileKey ? `   - Target file key: \`${fileKey}\`` : "   - This will create a new Figma file",
      "",
      "2. Create **colour variables** for each colour token above:",
      "   - Group by prefix (e.g. `color/primary`, `color/surface`, `bg/app`)",
      "   - Use the exact hex values listed",
      "",
      "3. Create **number variables** for spacing and radius tokens:",
      "   - Group spacing as `spacing/1`, `spacing/2`, etc.",
      "   - Group radius as `radius/sm`, `radius/md`, etc.",
      "   - Values should be the pixel numbers (strip `px` suffix)",
      "",
      "4. Create **text styles** for typography tokens:",
      "   - Map font-family, font-size, font-weight, and line-height",
      "   - Name styles by role (e.g. `heading/h1`, `body/default`)",
      "",
      shadowTokens.length > 0
        ? "5. Create **effect styles** for shadow tokens:\n   - Map box-shadow values to Figma drop shadows\n   - Name by elevation level"
        : "",
      "",
      "## Prerequisites",
      "",
      "Requires the Figma MCP server. Install with:",
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

interface TokenEntry {
  name: string;
  value: string;
}

/**
 * Parse CSS custom properties matching any of the given category keywords.
 */
function parseTokens(css: string, keywords: string[]): TokenEntry[] {
  return css
    .split("\n")
    .filter((line) => {
      if (!line.includes("--")) return false;
      const lower = line.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    })
    .map((line) => {
      const match = line.match(/--([\w-]+)\s*:\s*(.+?)\s*;?$/);
      if (!match) return null;
      return { name: `--${match[1]}`, value: match[2]!.replace(/;$/, "").trim() };
    })
    .filter((t): t is TokenEntry => t !== null)
    .slice(0, 100);
}

/**
 * Format token entries as a readable list.
 */
function formatTokens(tokens: TokenEntry[]): string {
  return tokens
    .map((t) => `- \`${t.name}\`: \`${t.value}\``)
    .join("\n");
}
