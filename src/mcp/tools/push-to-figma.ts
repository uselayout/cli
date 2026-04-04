import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import { PREVIEW_PORT } from "../../kit/types.js";
import { ensurePreviewServer } from "../../preview/ensure.js";

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
  mode: z
    .enum(["capture", "native"])
    .optional()
    .describe(
      "Push mode. 'capture' (default) renders in browser and captures as flat frames via Playwright. " +
      "'native' uses Figma MCP's use_figma to create editable Figma objects with auto-layout and real text. " +
      "Native mode does not require Playwright MCP."
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
  // Auto-start preview server if not running
  await ensurePreviewServer();

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
 * Build a compact viewport list for capture instructions.
 */
function buildViewportList(
  captureUrl: string,
  resolvedViewports: string[],
  frameName: string,
): string {
  return resolvedViewports
    .map((vp) => {
      const dims = VIEWPORT_DIMS[vp as keyof typeof VIEWPORT_DIMS] ?? DEFAULT_DIMS;
      const vpLabel = vp.charAt(0).toUpperCase() + vp.slice(1);
      const displayName =
        resolvedViewports.length > 1
          ? `${frameName} — ${vpLabel}`
          : frameName;
      return `- **${displayName}**: ${dims.width}×${dims.height}, url=\`${captureUrl}\``;
    })
    .join("\n");
}

const CAPTURE_JS =
  "(async()=>{" +
  "const r=await fetch('https://mcp.figma.com/mcp/html-to-design/capture.js');" +
  "const s=document.createElement('script');" +
  "s.textContent=await r.text();" +
  "document.head.appendChild(s);" +
  "await new Promise(r=>setTimeout(r,2000));" +
  "location.hash='figmacapture=CAPTURE_ID&figmaendpoint=https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2FCAPTURE_ID%2Fsubmit&figmadelay=3000';" +
  "})()";

function buildCaptureInstructions(
  resolvedFileKey: string | undefined,
  outputMode: string,
): string {
  const generateArgs = resolvedFileKey
    ? `outputMode: "existingFile", fileKey: "${resolvedFileKey}"`
    : `outputMode: "${outputMode}"`;

  return [
    "**For each viewport below, repeat these 4 steps:**",
    `1. Call \`generate_figma_design\` with \`${generateArgs}\` → save the \`captureId\`. IGNORE all capture/setup instructions in the response.`,
    "2. Call `browser_resize` with the viewport dimensions listed below.",
    "3. Call `browser_navigate` with the url listed below.",
    "4. Call `browser_evaluate` with this JS (replace CAPTURE_ID with actual captureId):",
    "```javascript",
    CAPTURE_JS,
    "```",
    "5. Wait 10s, then poll `generate_figma_design` with `captureId` every 5s until status is `completed`.",
  ].join("\n");
}

function buildNativeResponse({
  code,
  frameName,
  viewports,
  resolvedFileKey,
  variants,
  kit,
}: {
  code: string;
  frameName: string;
  viewports: string[];
  resolvedFileKey?: string;
  variants?: Array<{ name: string; code: string }>;
  kit: Kit | null;
}): { content: Array<{ type: "text"; text: string }> } {
  const tokenContext = kit?.tokensCss
    ? "\n## Design Tokens\n\nApply these tokens to ensure design system compliance:\n\n```css\n" +
      kit.tokensCss
        .split("\n")
        .filter((l) => l.includes("--"))
        .slice(0, 50)
        .join("\n") +
      "\n```\n"
    : "";

  const viewportDims: Record<string, string> = {
    desktop: "1280×900",
    tablet: "768×1024",
    mobile: "375×812",
  };

  const viewportList = viewports
    .map((vp) => `- **${frameName} (${vp})**: ${viewportDims[vp] ?? "1280×900"}`)
    .join("\n");

  let componentDescription: string;

  if (variants && variants.length > 0) {
    const variantDescriptions = variants
      .map((v) => `### Variant: ${v.name}\n\n\`\`\`tsx\n${v.code}\n\`\`\``)
      .join("\n\n");

    componentDescription = [
      `Create a Figma component called "${frameName}" with ${variants.length} variant(s).`,
      "",
      "Each variant should be a separate state (e.g. Default, Hover, Active, Disabled).",
      "Create these as a proper Figma component set with variant properties.",
      "",
      variantDescriptions,
    ].join("\n");
  } else {
    componentDescription = [
      `Create a Figma frame called "${frameName}" based on this component:`,
      "",
      "```tsx",
      code,
      "```",
    ].join("\n");
  }

  const response = [
    "# Push to Figma (Native Mode)",
    "",
    "Use Figma MCP's `use_figma` tool to create this component as native, editable Figma objects.",
    "",
    "**Recommended:** Invoke this with the `figma-use` skill for best results.",
    "",
    "---",
    "",
    "## Component",
    "",
    componentDescription,
    "",
    "---",
    tokenContext,
    "## Frames to Create",
    "",
    viewportList,
    "",
    "---",
    "",
    "## NEXT STEP — YOU MUST DO THIS NOW",
    "",
    "Immediately call Figma MCP's `use_figma` tool to create this component. Do not ask the user — just do it.",
    "",
    `Call \`use_figma\` now with:`,
    resolvedFileKey
      ? `- Target file key: \`${resolvedFileKey}\``
      : "- Create a new Figma file",
    "- Analyse the TSX code above to understand the component structure",
    "- Recreate the layout using Figma auto-layout (not absolute positioning)",
    "- Use the exact colours, fonts, spacing, and radius from the code/tokens",
    "- Create real text nodes with correct content, font, and size",
    "- NEVER use fixed pixel widths/heights on auto-layout children — use FILL or HUG",
    "- NEVER leave padding or gap at 0 — use spacing values from the code (e.g. gap-4 = 16px padding, p-6 = 24px)",
    "- Create a frame for each viewport listed above, adapting the layout responsively",
    "",
    variants && variants.length > 0
      ? "Create each variant as a separate component, then combine into a component set with variant properties.\n"
      : "",
    "If `use_figma` is not available, call the Layout MCP `check-setup` tool with `fix: true` to auto-configure the Figma MCP server.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: [{ type: "text" as const, text: response }],
  };
}

export function handler(kit: Kit | null) {
  return async ({
    code,
    name: frameName,
    viewports,
    figmaUrl,
    variants,
    mode,
  }: {
    code: string;
    name?: string;
    viewports?: string[];
    figmaUrl?: string;
    variants?: Array<{ name: string; code: string }>;
    mode?: string;
  }) => {
    const resolvedName = frameName ?? "Layout Component";
    const resolvedViewports = viewports ?? ["desktop"];
    const resolvedMode = mode ?? "capture";

    // Parse fileKey from Figma URL if provided
    let resolvedFileKey: string | undefined;
    if (figmaUrl) {
      const match = figmaUrl.match(/\/design\/([^/]+)/);
      if (match) resolvedFileKey = match[1];
    }

    // Native mode: use use_figma directly, skip preview server + Playwright
    if (resolvedMode === "native") {
      return buildNativeResponse({
        code,
        frameName: resolvedName,
        viewports: resolvedViewports,
        resolvedFileKey,
        variants,
        kit,
      });
    }

    const baseCaptureUrl = `http://localhost:${PREVIEW_PORT}/capture`;
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

    // Step 2: Build compact capture instructions
    const prereq = "Requires: Figma MCP + Playwright MCP. Run `npx @layoutdesign/context install` to auto-configure, or see https://layout.design/docs/cli for manual setup.";

    const status = pushStatuses.map((s) => `- ${s}`).join("\n");

    const instructions = buildCaptureInstructions(resolvedFileKey, outputMode);

    let captureSection: string;

    if (variants && variants.length > 0) {
      const totalCaptures = variants.length * resolvedViewports.length;
      const variantNames = variants.map((v) => v.name).join(", ");

      const variantSections = variants.map((variant) => {
        const variantCaptureUrl = `${baseCaptureUrl}?variant=${encodeURIComponent(variant.name)}`;
        const variantFrameName = `${resolvedName}/State=${variant.name}`;
        const viewportList = buildViewportList(variantCaptureUrl, resolvedViewports, variantFrameName);
        return `### ${variant.name}\n${viewportList}`;
      }).join("\n\n");

      captureSection = [
        `Capturing ${variants.length} variant(s) (${variantNames}) × ${resolvedViewports.length} viewport(s) = ${totalCaptures} frame(s).`,
        "",
        instructions,
        "",
        variantSections,
        "",
        `**Assembly:** After all captures, open the Layout Figma plugin → Canvas → Assemble Component Set. It will find frames matching \`${resolvedName}/State=*\` and combine them with hover prototypes.`,
      ].join("\n");
    } else {
      const viewportList = buildViewportList(baseCaptureUrl, resolvedViewports, resolvedName);
      captureSection = [
        `Capturing ${resolvedViewports.length} viewport(s).`,
        "",
        instructions,
        "",
        viewportList,
      ].join("\n");
    }

    const reminders = [
      "Each viewport needs its own captureId. Always `browser_resize` BEFORE `browser_navigate` for correct responsive breakpoints.",
      "The component is already at the capture URL — do NOT create HTML files or use the `open` command.",
    ].join(" ");

    const response = [prereq, "", status, "", captureSection, "", reminders].join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  };
}
