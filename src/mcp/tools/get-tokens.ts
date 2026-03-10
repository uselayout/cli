import { z } from "zod";
import type { Kit } from "../../kit/types.js";

export const name = "get-tokens";

export const description =
  "Returns design tokens in the requested format (CSS custom properties, W3C DTCG JSON, or Tailwind config). " +
  "Use this when you need exact token values for colours, spacing, typography, or shadows.";

export const inputSchema = {
  format: z
    .enum(["css", "json", "tailwind"])
    .default("css")
    .describe("Token format: 'css' for CSS custom properties, 'json' for W3C DTCG tokens, 'tailwind' for tailwind.config.js"),
};

export function handler(kit: Kit | null) {
  return async ({ format }: { format: "css" | "json" | "tailwind" }) => {
    if (!kit) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No design system kit found. Run `npx @superduperui/context init` to set one up.",
          },
        ],
      };
    }

    const formatMap: Record<string, { data: string | undefined; label: string }> = {
      css: { data: kit.tokensCss, label: "tokens.css" },
      json: { data: kit.tokensJson, label: "tokens.json" },
      tailwind: { data: kit.tailwindConfig, label: "tailwind.config.js" },
    };

    const entry = formatMap[format];
    if (!entry?.data) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No ${entry?.label ?? format} file found in the kit. Available formats: ${
              [
                kit.tokensCss ? "css" : null,
                kit.tokensJson ? "json" : null,
                kit.tailwindConfig ? "tailwind" : null,
              ]
                .filter(Boolean)
                .join(", ") || "none"
            }`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: entry.data }],
    };
  };
}
