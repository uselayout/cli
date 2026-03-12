import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import { extractSection } from "../../kit/parser.js";

export const name = "get-design-system";

export const description =
  "Returns the full DESIGN.md content for the active design system, or a specific section. " +
  "Use this to understand colours, typography, spacing, layout rules, and component specs before writing UI code.";

export const inputSchema = {
  section: z
    .string()
    .optional()
    .describe(
      "Optional keyword to filter to a specific section (e.g. 'colours', 'typography', 'spacing', 'components')"
    ),
};

export function handler(kit: Kit | null) {
  return async ({ section }: { section?: string }) => {
    if (!kit) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No design system kit found. Run `npx @layoutdesign/context init` in your project root to set one up, or place a DESIGN.md in .layout/.",
          },
        ],
      };
    }

    if (section) {
      const match = extractSection(kit.sections, section);
      if (!match) {
        const available = kit.sections.map((s) => s.title).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `No section matching "${section}" found. Available sections: ${available}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `## ${match.title}\n\n${match.content}`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: kit.designMd }],
    };
  };
}
