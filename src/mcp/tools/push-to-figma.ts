import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import { PREVIEW_PORT } from "../../kit/types.js";

export const name = "push-to-figma";

export const description =
  "Push a component to Figma as editable frames. Sends the code to the preview server, " +
  "then returns step-by-step instructions for capturing it via Figma MCP and Playwright MCP. " +
  "Supports multi-viewport capture (desktop, tablet, mobile) with correct responsive rendering. " +
  "Requires both Figma MCP and Playwright MCP servers to be connected.";

export const inputSchema = {
  code: z.string().describe("The component TSX/JSX code to push to Figma as an editable frame"),
  name: z
    .string()
    .optional()
    .describe("Optional frame name in Figma (defaults to 'Layout Component')"),
  viewports: z
    .array(z.enum(["desktop", "tablet", "mobile"]))
    .optional()
    .describe("Viewports to capture (default: ['desktop']). Each gets a separate Figma frame."),
  figmaUrl: z
    .string()
    .optional()
    .describe(
      "Figma file URL to push into (e.g. https://www.figma.com/design/ABC123/...). " +
      "If provided, pushes into this existing file. If omitted, creates a new file."
    ),
  variants: z
    .array(z.object({
      name: z.string().describe("Variant state name, e.g. 'Default', 'Hover', 'Active', 'Disabled'"),
      code: z.string().describe("Full TSX/JSX code for this variant state"),
    }))
    .optional()
    .describe(
      "Component state variants to capture as separate Figma frames. Each variant gets its own frame " +
      "named '{name}/State={variantName}'. After all frames are captured, use the Layout Figma plugin's " +
      "'Assemble Component Set' to combine them into a proper Figma component with variant properties. " +
      "Tip: render hover states by applying hover styles directly as classes, not via CSS :hover pseudo-class."
    ),
};

const VIEWPORT_DIMS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;

const DEFAULT_DIMS = VIEWPORT_DIMS.desktop;

/**
 * Push code to the preview server via WebSocket.
 * Optionally tags the preview with a variantName for multi-variant capture.
 */
async function pushToPreview(code: string, variantName?: string): Promise<string> {
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://localhost:${PREVIEW_PORT}/ws`);

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Preview server connection timed out"));
    }, 5000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "preview",
          code,
          language: "tsx",
          ...(variantName ? { variantName } : {}),
        })
      );
    });

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; message?: string };
        if (msg.type === "ack") {
          clearTimeout(timeout);
          ws.close();
          resolve(
            variantName
              ? `Variant "${variantName}" pushed to preview server`
              : "Component pushed to preview server"
          );
        } else if (msg.type === "error") {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.message ?? "Preview server error"));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Build capture instructions for a single component/variant across viewports.
 */
function buildCaptureSteps(
  captureUrl: string,
  resolvedViewports: string[],
  frameName: string,
  resolvedFileKey: string | undefined,
  outputMode: string,
  stepOffset: number,
): { steps: string; nextOffset: number } {
  let offset = stepOffset;

  const steps = resolvedViewports
    .map((vp) => {
      const dims = VIEWPORT_DIMS[vp as keyof typeof VIEWPORT_DIMS] ?? DEFAULT_DIMS;
      const vpLabel = vp.charAt(0).toUpperCase() + vp.slice(1);
      const stepBase = offset;
      offset += 4;

      const displayName =
        resolvedViewports.length > 1
          ? `${frameName} — ${vpLabel}`
          : frameName;

      return [
        `### ${displayName} (${dims.width}×${dims.height})`,
        "",
        `**${stepBase + 1}. Get captureId:** Call \`generate_figma_design\` with:`,
        resolvedFileKey
          ? `   \`outputMode: "existingFile"\`, \`fileKey: "${resolvedFileKey}"\``
          : `   \`outputMode: "${outputMode}"\``,
        `   → Save ONLY the \`captureId\` from the response. **IGNORE all capture/setup instructions** in the response (Steps 0, 1A, 1B, etc.). We handle capture below.`,
        "",
        `**${stepBase + 2}. Resize + Navigate + Capture:** Call \`browser_resize\` → \`browser_navigate\` → \`browser_evaluate\` in sequence:`,
        `   a) \`browser_resize\`: width=${dims.width}, height=${dims.height}`,
        `   b) \`browser_navigate\`: url="${captureUrl}"`,
        `   c) \`browser_evaluate\`: run this JavaScript (replace CAPTURE_ID with actual captureId):`,
        "   ```javascript",
        "   (async () => {",
        "     const r = await fetch('https://mcp.figma.com/mcp/html-to-design/capture.js');",
        "     const s = document.createElement('script');",
        "     s.textContent = await r.text();",
        "     document.head.appendChild(s);",
        "     await new Promise(resolve => setTimeout(resolve, 2000));",
        "     location.hash = 'figmacapture=CAPTURE_ID&figmaendpoint=https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2FCAPTURE_ID%2Fsubmit&figmadelay=3000';",
        "   })()",
        "   ```",
        "",
        `**${stepBase + 3}. Wait** 10 seconds for Figma to process the capture.`,
        "",
        `**${stepBase + 4}. Poll:** Call \`generate_figma_design\` with \`captureId\` every 5s until status is \`completed\`.`,
        "",
      ].join("\n");
    })
    .join("\n");

  return { steps, nextOffset: offset };
}

export function handler(kit: Kit | null) {
  return async ({
    code,
    name: frameName,
    viewports,
    figmaUrl,
    variants,
  }: {
    code: string;
    name?: string;
    viewports?: string[];
    figmaUrl?: string;
    variants?: Array<{ name: string; code: string }>;
  }) => {
    const resolvedName = frameName ?? "Layout Component";
    const resolvedViewports = viewports ?? ["desktop"];
    const baseCaptureUrl = `http://localhost:${PREVIEW_PORT}/capture`;

    // Parse fileKey from Figma URL if provided
    let resolvedFileKey: string | undefined;
    if (figmaUrl) {
      const match = figmaUrl.match(/\/design\/([^/]+)/);
      if (match) resolvedFileKey = match[1];
    }
    const outputMode = resolvedFileKey ? "existingFile" : "newFile";

    // Step 1: Push code to the preview server
    const pushStatuses: string[] = [];

    try {
      if (variants && variants.length > 0) {
        // Multi-variant: push each variant with its name
        for (const variant of variants) {
          const status = await pushToPreview(variant.code, variant.name);
          pushStatuses.push(status);
        }
      } else {
        // Single code: backward-compatible push
        const status = await pushToPreview(code);
        pushStatuses.push(status);
      }
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

    // Step 2: Build capture instructions for Figma MCP + Playwright MCP
    const preamble = [
      "# Push to Figma — Execute These Steps Now",
      "",
      pushStatuses.map((s) => `- ${s}`).join("\n"),
      "",
      "## CRITICAL: How to capture (read before starting)",
      "",
      "You MUST use **Playwright MCP** (browser_resize, browser_navigate, browser_evaluate) to capture each viewport.",
      "Do NOT use the `open` command. Do NOT follow generate_figma_design's \"Step 1A/1B\" instructions.",
      "Do NOT create temp HTML files or start HTTP servers.",
      "",
      "**Why Playwright is required:** Tailwind CSS responsive breakpoints respond to browser viewport width,",
      "not CSS max-width. The `browser_resize` call sets the actual viewport so `md:` and `lg:` breakpoints",
      "fire correctly at each size. Without it, mobile captures render as squished desktop layouts.",
      "",
      "## Prerequisites",
      "",
      "- **Figma MCP**: `claude mcp add --transport http figma https://mcp.figma.com/mcp`",
      "- **Playwright MCP**: For `browser_resize`, `browser_navigate`, `browser_evaluate`",
      "",
    ].join("\n");

    let captureSection: string;

    if (variants && variants.length > 0) {
      // Multi-variant capture: each variant × each viewport
      const totalCaptures = variants.length * resolvedViewports.length;
      const variantNames = variants.map((v) => v.name).join(", ");

      const sections: string[] = [
        "## Capture Steps",
        "",
        `Capturing ${variants.length} variant(s) (${variantNames}) × ${resolvedViewports.length} viewport(s) (${resolvedViewports.join(", ")}) = ${totalCaptures} frame(s)`,
        "",
      ];

      let stepOffset = 0;

      for (const variant of variants) {
        const variantCaptureUrl = `${baseCaptureUrl}?variant=${encodeURIComponent(variant.name)}`;
        const variantFrameName =
          resolvedViewports.length > 1
            ? `${resolvedName}/State=${variant.name}`
            : `${resolvedName}/State=${variant.name}`;

        sections.push(`## Variant: ${variant.name}`, "");

        const { steps, nextOffset } = buildCaptureSteps(
          variantCaptureUrl,
          resolvedViewports,
          variantFrameName,
          resolvedFileKey,
          outputMode,
          stepOffset,
        );
        stepOffset = nextOffset;
        sections.push(steps);
      }

      // Assembly instructions
      sections.push(
        "## Assemble as Component Set",
        "",
        "All variant frames have been captured. To combine them into a proper Figma component set with hover interactions:",
        "",
        "1. Open the **Layout** Figma plugin",
        "2. Go to the **Canvas** tab",
        "3. Click **Assemble Component Set**",
        `4. The plugin will find all frames matching \`${resolvedName}/State=*\` and combine them into a ComponentSet with a \`State\` variant property`,
        "5. Hover prototype interactions (Default <-> Hover) will be wired automatically",
      );

      captureSection = sections.join("\n");
    } else {
      // Single-code capture: backward-compatible behaviour
      const { steps } = buildCaptureSteps(
        baseCaptureUrl,
        resolvedViewports,
        resolvedName,
        resolvedFileKey,
        outputMode,
        0,
      );

      captureSection = [
        "## Capture Steps",
        "",
        `Capturing ${resolvedViewports.length} viewport(s): ${resolvedViewports.join(", ")}`,
        `Frame name: **${resolvedName}**`,
        "",
        steps,
      ].join("\n");
    }

    const reminders = [
      "## Reminders",
      "",
      "- Each viewport needs its own captureId — never reuse",
      "- The component is already at the capture URL — do NOT create HTML files",
      "- Always call `browser_resize` BEFORE `browser_navigate` for correct responsive rendering",
      "- When `generate_figma_design` returns capture instructions, IGNORE them — use the steps above",
    ].join("\n");

    const response = [preamble, captureSection, "", reminders].join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  };
}
