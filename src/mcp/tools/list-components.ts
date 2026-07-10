import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import type { ScanResult } from "../../integrations/codebase-scan.js";

export const name = "list-components";

export const description =
  "Lists all available components: design system components from layout.md, " +
  "auto-detected React components from the codebase, and Storybook stories. " +
  "Use this to discover existing components before building new UI. " +
  "Pre-built Layout UI components are also available: use the list-ui-components " +
  "tool, install with `npx @layoutdesign/context add <name>`.";

export const inputSchema = {
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Output format: 'text' for a markdown inventory (default), 'json' for a structured component list"
    ),
};

/** One entry in the `format: "json"` output. */
export interface ComponentListEntry {
  name: string;
  description?: string;
  source: "design-system" | "codebase";
  /** Whether get-component can return a code example for it. */
  hasCode: boolean;
  tokens?: string[];
  filePath?: string;
  props?: string[];
  stories?: string[];
}

export function handler(kit: Kit | null, scanResult: ScanResult | null) {
  return async ({ format }: { format?: "text" | "json" } = {}) => {
    if (format === "json") {
      const components: ComponentListEntry[] = [
        ...(kit?.components ?? []).map((c): ComponentListEntry => ({
          name: c.name,
          ...(c.description && { description: c.description }),
          source: "design-system",
          hasCode: Boolean(c.codeExample),
          ...(c.tokens.length > 0 && { tokens: c.tokens }),
        })),
        ...(scanResult?.components ?? []).slice(0, 100).map(
          (c): ComponentListEntry => ({
            name: c.name,
            source: "codebase",
            hasCode: false,
            filePath: c.filePath,
            ...(c.props.length > 0 && {
              props: c.props.map((p) => p.name),
            }),
            ...(c.storybook && {
              stories: c.storybook.stories.map((s) => s.name),
            }),
          })
        ),
      ];
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ components }) },
        ],
      };
    }

    const sections: string[] = [];

    // 1. Design system components from layout.md
    if (kit && kit.components.length > 0) {
      const lines = kit.components.map(
        (c) => `- **${c.name}** — ${c.description || "No description"}`
      );
      sections.push(`## Design System (from layout.md)\n\n${lines.join("\n")}`);
    }

    // 2. Codebase components (auto-scanned)
    if (scanResult && scanResult.components.length > 0) {
      const lines = scanResult.components
        .slice(0, 100) // cap for context budget
        .map((c) => {
          const propsStr = c.props.length > 0
            ? ` props: ${c.props.map(p => p.name).join(", ")}`
            : "";
          const storyStr = c.storybook
            ? ` [Storybook: ${c.storybook.stories.map(s => s.name).join(", ")}]`
            : "";
          const refStr = c.usesForwardRef ? " (forwardRef)" : "";
          const importPath = buildImportPath(c.filePath);
          const importStatement = c.exportType === "default"
            ? `import ${c.name} from '${importPath}'`
            : `import { ${c.name} } from '${importPath}'`;
          return `- **${c.name}** (${c.filePath})${propsStr}${refStr}${storyStr}\n  Import: \`${importStatement}\``;
        });
      sections.push(`## Your Codebase (auto-detected)\n\n${lines.join("\n")}`);
    }

    const uiPointer =
      "\n\n---\nPre-built Layout UI components are also available: use the " +
      "list-ui-components tool, install with `npx @layoutdesign/context add <name>`.";

    if (sections.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: "No components found. Set up a design system with `npx @layoutdesign/context init` or create React components in this project." + uiPointer,
        }],
      };
    }

    const total = (kit?.components.length ?? 0) + (scanResult?.components.length ?? 0);

    return {
      content: [{
        type: "text" as const,
        text: `# Components (${total})\n\n${sections.join("\n\n")}\n\n---\n**IMPORTANT:** When building UI, reuse existing components listed above. Import from the paths shown. Do NOT generate a new Button/Card/Input if one already exists.${uiPointer}`,
      }],
    };
  };
}

function buildImportPath(filePath: string): string {
  // Convert file path to import path: src/components/ui/button.tsx -> @/components/ui/button
  let importPath = filePath
    .replace(/\.(tsx?|jsx?)$/, "")
    .replace(/\/index$/, "");

  if (importPath.startsWith("src/")) {
    importPath = "@/" + importPath.slice(4);
  } else if (!importPath.startsWith(".") && !importPath.startsWith("@")) {
    importPath = "./" + importPath;
  }

  return importPath;
}
