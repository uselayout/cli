import type { Kit } from "../../kit/types.js";

export const name = "list-components";

export const description =
  "Lists all available components in the active design system kit with their names and descriptions. " +
  "Use this to discover what components are available before requesting details on a specific one.";

export const inputSchema = {};

export function handler(kit: Kit | null) {
  return async () => {
    if (!kit) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No design system kit found. Run `npx @layoutdesign/context init` to set one up.",
          },
        ],
      };
    }

    if (kit.components.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No components defined in this kit. Components are parsed from the ## Components section in DESIGN.md.",
          },
        ],
      };
    }

    const lines = kit.components.map(
      (c) => `- **${c.name}** — ${c.description || "No description"}`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `# Components (${kit.components.length})\n\n${lines.join("\n")}`,
        },
      ],
    };
  };
}
