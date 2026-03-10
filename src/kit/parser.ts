import type { KitSection, KitComponent } from "./types.js";

/**
 * Parse a DESIGN.md file into structured sections.
 * Splits on ## headings and extracts section IDs.
 */
export function parseDesignMd(content: string): KitSection[] {
  const sections: KitSection[] = [];
  const lines = content.split("\n");

  let currentTitle = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(?:Section\s+\d+:\s*)?(.+)/);
    if (headingMatch) {
      if (currentTitle) {
        sections.push({
          id: slugify(currentTitle),
          title: currentTitle,
          content: currentLines.join("\n").trim(),
        });
      }
      currentTitle = headingMatch[1]!.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentTitle) {
    sections.push({
      id: slugify(currentTitle),
      title: currentTitle,
      content: currentLines.join("\n").trim(),
    });
  }

  return sections;
}

/**
 * Extract Quick Reference section (Section 0) from DESIGN.md.
 * This is the 50-75 line summary optimised for LLM context windows.
 */
export function extractQuickReference(content: string): string {
  const match = content.match(
    /## (?:Section 0:|Quick Reference)[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/
  );
  return match?.[1]?.trim() ?? "";
}

/**
 * Extract a specific section by keyword match.
 */
export function extractSection(
  sections: KitSection[],
  keyword: string
): KitSection | undefined {
  const lower = keyword.toLowerCase();
  return sections.find(
    (s) =>
      s.id.includes(lower) ||
      s.title.toLowerCase().includes(lower)
  );
}

/**
 * Parse component specs from DESIGN.md or individual component files.
 * Components are expected in a "## Components" section with ### per component.
 */
export function parseComponents(content: string): KitComponent[] {
  const components: KitComponent[] = [];
  const componentSection = content.match(
    /## (?:Section \d+:\s*)?Components?\s*\n([\s\S]*?)(?=\n## |\n# |$)/
  );

  if (!componentSection?.[1]) return components;

  const entries = componentSection[1].split(/\n### /);

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const lines = entry.split("\n");
    const name = lines[0]?.trim() ?? "";
    if (!name) continue;

    const body = lines.slice(1).join("\n");

    const codeMatch = body.match(/```(?:tsx?|jsx?)\n([\s\S]*?)```/);
    const tokenMatches = body.match(/--[\w-]+/g) ?? [];

    components.push({
      name,
      description: extractDescription(body),
      tokens: [...new Set(tokenMatches)],
      codeExample: codeMatch?.[1]?.trim(),
    });
  }

  return components;
}

function extractDescription(body: string): string {
  const lines = body.split("\n");
  const descLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("```") || line.startsWith("###") || line.startsWith("- `--")) break;
    if (line.trim()) descLines.push(line.trim());
  }
  return descLines.join(" ").slice(0, 200);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
