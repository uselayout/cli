import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import { PREVIEW_PORT } from "../../kit/types.js";

export const name = "push-to-figma";

export const description =
  "Bridges to Figma MCP to push rendered component code as editable Figma frames. " +
  "The component is rendered live at the preview URL (localhost:4321) which Figma MCP " +
  "can capture via generate_figma_design. Requires the Figma MCP server to be connected.";

export const inputSchema = {
  code: z.string().describe("The component code to push to Figma as an editable frame"),
  name: z
    .string()
    .optional()
    .describe("Optional frame name in Figma (defaults to 'SuperDuper Component')"),
};

export function handler(kit: Kit | null) {
  return async ({ code, name: frameName }: { code: string; name?: string }) => {
    const resolvedName = frameName ?? "SuperDuper Component";
    const captureUrl = `http://localhost:${PREVIEW_PORT}/capture`;
    const previewUrl = `http://localhost:${PREVIEW_PORT}`;

    // Build token context for Figma rendering
    let tokenContext = "";
    if (kit?.tokensCss) {
      const tokenLines = kit.tokensCss
        .split("\n")
        .filter(
          (line) =>
            line.includes("--") &&
            (line.includes("color") ||
              line.includes("colour") ||
              line.includes("bg") ||
              line.includes("text") ||
              line.includes("border") ||
              line.includes("radius") ||
              line.includes("spacing") ||
              line.includes("font"))
        )
        .slice(0, 30);

      if (tokenLines.length > 0) {
        tokenContext = `\n\nDesign Tokens:\n${tokenLines.join("\n")}`;
      }
    }

    const response = [
      "# Push to Figma",
      "",
      "The component is rendered live at the preview canvas.",
      "",
      "## Next Step",
      "",
      "Call Figma MCP's `generate_figma_design` tool to capture the standalone component page:",
      "",
      `1. **Use this URL for capture:** ${captureUrl}`,
      "   This serves the component standalone (no preview chrome) for clean Figma capture.",
      `2. The interactive preview with toolbar is at ${previewUrl}`,
      `3. Use \`generate_figma_design\` with \`outputMode: "existingFile"\` to capture into your Figma file`,
      `4. Name the frame: **${resolvedName}**`,
      "",
      "## Setup (if Figma MCP is not connected)",
      "",
      "Add the Figma MCP server to your agent:",
      "",
      "**Claude Code:**",
      "```bash",
      "claude mcp add --transport http figma https://mcp.figma.com/mcp",
      "```",
      "",
      "**Cursor:** Use `/plugin-add figma`",
      "",
      "Authentication is via OAuth — no API key needed.",
      "",
      "## Component Code",
      "",
      "```tsx",
      code,
      "```",
      tokenContext,
      "",
      `**Capture URL:** ${captureUrl}`,
      `**Preview URL:** ${previewUrl}`,
      `**Frame name:** ${resolvedName}`,
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  };
}
