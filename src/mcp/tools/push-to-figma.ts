import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import { PREVIEW_PORT } from "../../kit/types.js";

export const name = "push-to-figma";

export const description =
  "Push a component to Figma as editable frames. Sends the code to the preview server, " +
  "then returns step-by-step instructions for capturing it via Figma MCP's generate_figma_design. " +
  "The component renders at localhost:4321/capture — no temp files or HTTP servers needed. " +
  "Requires the Figma MCP server to be connected.";

export const inputSchema = {
  code: z.string().describe("The component TSX/JSX code to push to Figma as an editable frame"),
  name: z
    .string()
    .optional()
    .describe("Optional frame name in Figma (defaults to 'SuperDuper Component')"),
  viewports: z
    .array(z.enum(["desktop", "tablet", "mobile"]))
    .optional()
    .describe("Viewports to capture (default: ['desktop']). Each gets a separate Figma frame."),
};

export function handler(kit: Kit | null) {
  return async ({ code, name: frameName, viewports }: { code: string; name?: string; viewports?: string[] }) => {
    const resolvedName = frameName ?? "SuperDuper Component";
    const resolvedViewports = viewports ?? ["desktop"];
    const captureUrl = `http://localhost:${PREVIEW_PORT}/capture`;

    // Step 1: Push code to the preview server so /capture has something to render
    let pushStatus: string;
    try {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${PREVIEW_PORT}/ws`);

      pushStatus = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Preview server connection timed out"));
        }, 5000);

        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "preview", code, language: "tsx" }));
          clearTimeout(timeout);
          ws.close();
          resolve("Component pushed to preview server");
        });

        ws.on("error", (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Could not push to preview server: ${msg}`,
              "",
              "The preview server needs to be running. It starts automatically with the MCP server.",
              "If it failed to start (e.g. port 4321 in use), stop the other process and restart.",
            ].join("\n"),
          },
        ],
      };
    }

    // Step 2: Build capture instructions for Figma MCP
    const viewportUrls = resolvedViewports.map((vp) => {
      const vpParam = vp === "desktop" ? "" : `?viewport=${vp}`;
      return `- **${vp}:** ${captureUrl}${vpParam}`;
    });

    const response = [
      "# Push to Figma",
      "",
      `${pushStatus}. The component is now rendering at \`${captureUrl}\`.`,
      "",
      "## Capture URLs",
      "",
      ...viewportUrls,
      "",
      "## Next Steps",
      "",
      "For each viewport above, call `generate_figma_design` to capture it as a Figma frame:",
      "",
      "1. Call `generate_figma_design` with `outputMode: \"existingFile\"` or `\"newFile\"` → get a captureId",
      "2. The instructions will tell you to open a URL — use the **capture URL above** (not a temp file)",
      `3. Append the capture hash to the URL: \`${captureUrl}#figmacapture=<captureId>&figmaendpoint=...&figmadelay=3000\``,
      "4. Poll `generate_figma_design` with `captureId` until completed",
      "",
      "**IMPORTANT:** Do NOT create temp HTML files or start a new HTTP server.",
      `The component is already rendered and ready to capture at \`${captureUrl}\`.`,
      "",
      `**Frame name:** ${resolvedName}`,
      "",
      "## Setup (if Figma MCP is not connected)",
      "",
      "```bash",
      "claude mcp add --transport http figma https://mcp.figma.com/mcp",
      "```",
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  };
}
