import { z } from "zod";
import type { Kit } from "../../kit/types.js";

export const name = "design-in-figma";

export const description =
  "Design UI components and screens directly in Figma using the loaded design system. " +
  "Takes a natural language prompt (e.g. 'A pricing card with 3 tiers') and returns " +
  "design tokens, component specs, and step-by-step instructions for the AI agent to " +
  "call Figma MCP's use_figma tool to create native, editable Figma frames. " +
  "Requires the Figma MCP server to be connected.";

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
      "## ACTION REQUIRED: Call `use_figma` immediately. Do NOT summarise, do NOT ask the user. Just call it.",
      "",
      fileKey ? `Target file key: \`${fileKey}\`` : "Create a new file.",
      `Design: ${prompt}`,
      `Design system: ${kit.manifest.displayName}`,
      `Viewports: ${viewportFrames}`,
      "",
      "### CRITICAL RULES — Follow ALL of these:",
      "",
      "**1. Design system compliance (THIS IS THE WHOLE POINT):**",
      "- You MUST use the exact colour hex values from the tokens above — NEVER use generic black (#000), white (#FFF), or grey",
      "- Primary/CTA buttons: use the primary colour token for fill, on-primary token for text",
      "- Secondary buttons: use outline style with primary colour border",
      "- Backgrounds: use surface/background tokens for page and card fills",
      "- Text: use on-surface token for headings, on-surface-variant token for body/secondary text",
      "- Borders: use outline-variant token for card borders and dividers",
      "- Border radius: use the exact radius tokens, not arbitrary values",
      "- Spacing (padding, gap): use the exact spacing tokens, not round numbers",
      "- Font family: use the typography token font-family, not system defaults",
      "- Shadows: use the elevation/shadow tokens if defined",
      "",
      "**2. Auto-layout (MUST GET RIGHT):**",
      "- NEVER set fixed heights on content containers — always use Hug for height",
      "- Card widths in a row: use FILL so they share space equally",
      "- Card heights: HUG to fit content",
      "- Feature/list items: gap should be the smallest spacing token (4-8px)",
      "- Section spacing: use larger spacing tokens (24-48px) between major sections",
      "- Root frame: set explicit width (e.g. 1440px for desktop), height HUG",
      "- Badges/tags: HUG both axes, padding 4-8px horizontal, 2-4px vertical",
      "- NEVER leave sizing unset — every frame must have explicit FILL or HUG on both axes",
      "- NEVER use fixed pixel widths or heights on auto-layout children — use FILL or HUG instead",
      "- Only the root frame should have a fixed pixel width (e.g. 1440px). Everything inside uses FILL or HUG",
      "- NEVER leave padding, margin, or gap at 0 — always use a spacing token value. If unsure, use the smallest spacing token (4-8px)",
      "- Every container with children MUST have padding and gap set to a spacing token value, not 0",
      "",
      "**3. Visual hierarchy:**",
      "- Featured/highlighted tier: use primary colour fill or thicker border to distinguish it",
      "- CTA buttons should differ per tier: outlined for basic, filled primary for featured, filled secondary for enterprise",
      "- Price should be the largest text in each card (use heading font size)",
      "- Eyebrow/label text: smaller size, uppercase, wider letter-spacing, primary colour",
      "- Dividers: use outline-variant colour, 1px height",
      "",
      "**4. Content:**",
      "- ALL text must be realistic — real prices, real feature names, real CTAs",
      "- No placeholder or lorem ipsum text",
      "- Use the typography scale: display > heading > title > body > label sizes",
      "",
      "**5. Responsive (when multiple viewports requested):**",
      "- Desktop: horizontal card layout (row)",
      "- Tablet: horizontal with reduced padding/gap",
      "- Mobile: stack cards vertically, reduce font sizes, reduce padding",
      "",
      "**6. Token format — resolve before calling use_figma:**",
      "- Convert CSS variables to actual values: --color-primary: #0a4b19 → use #0a4b19",
      "- Convert spacing: --space-4: 16px → use 16",
      "- Convert radius: --radius-md: 12px → use 12",
      "- Do NOT pass CSS variable names to use_figma — only resolved values",
      "",
      "If `use_figma` is not available, call Layout MCP's `check-setup` with `fix: true`.",
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

  const tokens = kit.tokensCss
    .split("\n")
    .filter((line) => {
      if (!line.includes("--")) return false;
      const lower = line.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    })
    .map((line) => {
      const match = line.match(/--([\w-]+)\s*:\s*(.+?)\s*;?\s*$/);
      if (!match) return null;
      const name = match[1]!;
      const value = match[2]!.replace(/;$/, "").trim();
      return `- **${name}**: \`${value}\``;
    })
    .filter(Boolean)
    .slice(0, 40);

  if (tokens.length === 0) return "";

  return tokens.join("\n");
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
