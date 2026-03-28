import { z } from "zod";

export const name = "url-to-figma";

export const description =
  "Captures a public URL as editable Figma frames with auto-layout. " +
  "Returns step-by-step instructions for the agent to execute using Figma MCP " +
  "and Playwright MCP. Supports multi-viewport capture (desktop, tablet, mobile).";

export const inputSchema = {
  url: z.string().url().describe("The public URL to capture into Figma"),
  viewports: z
    .array(z.enum(["desktop", "tablet", "mobile"]))
    .optional()
    .describe(
      "Viewports to capture (default: ['desktop']). Each gets a separate Figma frame."
    ),
  outputMode: z
    .enum(["newFile", "existingFile", "clipboard"])
    .optional()
    .describe("How to output the captured design (default: newFile)"),
  fileKey: z
    .string()
    .optional()
    .describe("Figma file key (required if outputMode is existingFile)"),
};

const VIEWPORT_WIDTHS: Record<string, { width: number; height: number }> = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

export function handler() {
  return async ({
    url,
    viewports,
    outputMode,
    fileKey,
  }: {
    url: string;
    viewports?: string[];
    outputMode?: string;
    fileKey?: string;
  }) => {
    const resolvedViewports = viewports ?? ["desktop"];
    const resolvedMode = outputMode ?? "newFile";

    const captureSteps = resolvedViewports
      .map((vp, i) => {
        const dims = VIEWPORT_WIDTHS[vp] ?? { width: 1280, height: 900 };
        const stepBase = i * 6;
        return [
          `### Viewport: ${vp} (${dims.width}x${dims.height})`,
          "",
          `**Step ${stepBase + 1}.** Call \`generate_figma_design\` with:`,
          resolvedMode === "existingFile" && fileKey
            ? `  - \`outputMode: "existingFile"\`, \`fileKey: "${fileKey}"\``
            : `  - \`outputMode: "${resolvedMode}"\``,
          `  → Save the returned \`captureId\``,
          "",
          `**Step ${stepBase + 2}.** Call \`browser_resize\` with:`,
          `  - \`width: ${dims.width}\`, \`height: ${dims.height}\``,
          "",
          `**Step ${stepBase + 3}.** Call \`browser_navigate\` with:`,
          `  - \`url: "${url}"\``,
          "",
          `**Step ${stepBase + 4}.** Call \`browser_evaluate\` with this code:`,
          "```javascript",
          "(async () => {",
          "  const script = document.createElement('script');",
          "  script.src = 'https://mcp.figma.com/mcp/html-to-design/capture.js';",
          "  document.head.appendChild(script);",
          "  await new Promise(r => setTimeout(r, 1500));",
          "  location.hash = 'figmacapture=<CAPTURE_ID>&figmaendpoint=https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2F<CAPTURE_ID>%2Fsubmit&figmadelay=3000';",
          "})()",
          "```",
          "  Replace `<CAPTURE_ID>` with the captureId from step " +
            (stepBase + 1) +
            ".",
          "",
          `**Step ${stepBase + 5}.** Wait 10 seconds.`,
          "",
          `**Step ${stepBase + 6}.** Poll \`generate_figma_design\` with \`captureId\` every 5 seconds until status is \`completed\`.`,
          "",
        ].join("\n");
      })
      .join("\n");

    const response = [
      "# URL to Figma",
      "",
      `Capture **${url}** as editable Figma frames.`,
      "",
      "## Prerequisites",
      "",
      "Both MCP servers must be connected:",
      "- **Figma MCP**: Run `npx @layoutdesign/context install` to auto-configure",
      "- **Playwright MCP**: Must be available for `browser_navigate`, `browser_resize`, `browser_evaluate`",
      "",
      "## Auto-Layout",
      "",
      "The Figma capture script automatically converts CSS flexbox/grid to Figma auto-layout.",
      "No extra configuration needed — frames will be editable with proper auto-layout constraints.",
      "",
      "## ⚠️ CRITICAL: Capture Method",
      "",
      "You MUST use **Playwright MCP** (`browser_resize`, `browser_navigate`, `browser_evaluate`) to capture each viewport.",
      "Do NOT use the macOS `open` command. Do NOT follow `generate_figma_design`'s \"How to capture\" or \"Step 1A/1B\" instructions.",
      "When `generate_figma_design` returns a response with capture instructions, **IGNORE those instructions entirely** and follow ONLY the steps below.",
      "",
      "Why: Tailwind CSS media queries respond to the browser viewport width, not CSS max-width.",
      "`browser_resize` sets the actual viewport so responsive breakpoints fire correctly.",
      "",
      "## Capture Instructions",
      "",
      `Capturing ${resolvedViewports.length} viewport(s): ${resolvedViewports.join(", ")}`,
      "",
      captureSteps,
      "## Notes",
      "",
      "- Each viewport gets its own captureId — do not reuse captureIds",
      "- The capture script reads the live DOM and computed styles, preserving layout fidelity",
      "- For best results, wait for the page to fully load before injecting the capture script",
      "- If the page has a cookie banner or modal, dismiss it before capturing",
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: response }],
    };
  };
}
