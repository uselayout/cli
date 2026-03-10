import { z } from "zod";
import type { Kit } from "../../kit/types.js";

export const name = "get-component";

export const description =
  "Returns a specific component's specification including description, design tokens used, and code example. " +
  "Use this when you need to implement or modify a specific component from the design system.";

export const inputSchema = {
  name: z.string().describe("Component name to look up (case-insensitive, e.g. 'Button', 'card', 'NavBar')"),
};

export function handler(kit: Kit | null) {
  return async ({ name: componentName }: { name: string }) => {
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

    const lower = componentName.toLowerCase();
    const component = kit.components.find(
      (c) => c.name.toLowerCase() === lower
    );

    if (!component) {
      const available = kit.components.map((c) => c.name).join(", ");
      return {
        content: [
          {
            type: "text" as const,
            text: `Component "${componentName}" not found. Available components: ${available || "none"}`,
          },
        ],
      };
    }

    const parts: string[] = [`# ${component.name}`, ""];

    if (component.description) {
      parts.push(component.description, "");
    }

    if (component.tokens.length > 0) {
      parts.push("## Tokens Used", "");
      for (const token of component.tokens) {
        parts.push(`- \`${token}\``);
      }
      parts.push("");
    }

    if (component.codeExample) {
      parts.push("## Code Example", "", "```tsx", component.codeExample, "```");
    }

    return {
      content: [{ type: "text" as const, text: parts.join("\n") }],
    };
  };
}
