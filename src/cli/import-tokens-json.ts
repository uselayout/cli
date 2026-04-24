import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LAYOUT_DIR, KIT_MANIFEST_FILE, LAYOUT_MD_FILE, TOKENS_CSS_FILE, TOKENS_JSON_FILE } from "../kit/types.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

interface DtcgToken {
  $type?: string;
  $value?: unknown;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

// Flatten a DTCG tokens.json tree into CSS custom properties.
// The output matches what generateTokensCss produces in Studio, so round-trips
// through export → import stay structurally stable.
function flattenToCss(tree: Record<string, unknown>, prefix = ""): Array<{ name: string; value: string; category: string; description?: string }> {
  const out: Array<{ name: string; value: string; category: string; description?: string }> = [];

  for (const [key, rawValue] of Object.entries(tree)) {
    if (!rawValue || typeof rawValue !== "object") continue;
    const value = rawValue as DtcgToken | Record<string, unknown>;

    if ("$value" in value) {
      const token = value as DtcgToken;
      const cssName = prefix ? `--${prefix}-${key}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-") : `--${key}`.toLowerCase();
      const cssValue = stringifyValue(token.$value);
      if (cssValue !== null) {
        out.push({
          name: cssName,
          value: cssValue,
          category: topLevelCategory(prefix),
          description: token.$description,
        });
      }
    } else {
      out.push(...flattenToCss(value as Record<string, unknown>, prefix ? `${prefix}-${key}` : key));
    }
  }
  return out;
}

function topLevelCategory(prefix: string): string {
  const first = prefix.split("-")[0] || "other";
  if (first === "color" || first === "colors") return "Colours";
  if (first === "typography") return "Typography";
  if (first === "spacing" || first === "space" || first === "dimension") return "Spacing";
  if (first === "radius" || first === "rounded") return "Radius";
  if (first === "shadow" || first === "effect" || first === "elevation") return "Effects";
  if (first === "motion" || first === "duration") return "Motion";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function stringifyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return `${v}`;
  if (typeof v === "object") {
    // Typography composite — flatten to shorthand if possible.
    const obj = v as Record<string, unknown>;
    if ("fontFamily" in obj && "fontSize" in obj) {
      const family = obj.fontFamily as string;
      const size = obj.fontSize as string;
      const weight = (obj.fontWeight as string | number | undefined) ?? 400;
      const lh = (obj.lineHeight as string | undefined) ?? "1.5";
      return `${weight} ${size}/${lh} ${family}`;
    }
    // Fall back to JSON-encoded value so it at least survives.
    return JSON.stringify(v);
  }
  return null;
}

export async function importTokensJsonCommand(
  tokensJsonPath: string,
  options: { name?: string; path?: string } = {},
): Promise<void> {
  const input = resolve(tokensJsonPath);
  if (!existsSync(input)) {
    process.stderr.write(`${RED}tokens.json not found at ${input}${RESET}\n`);
    process.exit(1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(input, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    process.stderr.write(`${RED}Failed to parse tokens.json: ${err instanceof Error ? err.message : "unknown"}${RESET}\n`);
    process.exit(1);
  }

  const projectName = options.name ?? "Imported Kit";
  const targetRoot = resolve(options.path ?? process.cwd());
  const layoutDir = join(targetRoot, LAYOUT_DIR);
  if (!existsSync(layoutDir)) mkdirSync(layoutDir, { recursive: true });

  const cssTokens = flattenToCss(parsed);
  const grouped = new Map<string, typeof cssTokens>();
  for (const t of cssTokens) {
    const arr = grouped.get(t.category) ?? [];
    arr.push(t);
    grouped.set(t.category, arr);
  }

  const cssLines: string[] = [":root {"];
  for (const [category, tokens] of grouped) {
    cssLines.push(`  /* === ${category} === */`);
    for (const t of tokens) {
      const comment = t.description ? `  /* ${t.description} */` : "";
      cssLines.push(`  ${t.name}: ${t.value};${comment}`);
    }
    cssLines.push("");
  }
  cssLines.push("}");
  const tokensCss = cssLines.join("\n") + "\n";

  // Pass tokens.json through as-is so downstream tooling still sees the
  // canonical DTCG shape.
  const tokensJson = JSON.stringify(parsed, null, 2) + "\n";

  const layoutMd = buildLayoutMdSkeleton(projectName, grouped);
  const kitJson = JSON.stringify(
    {
      name: slugify(projectName),
      version: "0.1.0",
      displayName: projectName,
      description: "Imported from DTCG tokens.json",
      source: "tokens-json",
      tier: "free",
      tokenCount: cssTokens.length,
      componentCount: 0,
      aesthetic: "Imported",
    },
    null,
    2,
  ) + "\n";

  writeFileSync(join(layoutDir, LAYOUT_MD_FILE), layoutMd);
  writeFileSync(join(layoutDir, TOKENS_CSS_FILE), tokensCss);
  writeFileSync(join(layoutDir, TOKENS_JSON_FILE), tokensJson);
  writeFileSync(join(layoutDir, KIT_MANIFEST_FILE), kitJson);

  process.stdout.write(
    `${GREEN}✔${RESET} Imported ${cssTokens.length} tokens into ${BOLD}${LAYOUT_DIR}/${RESET}\n` +
      `  ${DIM}${LAYOUT_MD_FILE}${RESET}  ${DIM}${TOKENS_CSS_FILE}${RESET}  ${DIM}${TOKENS_JSON_FILE}${RESET}  ${DIM}${KIT_MANIFEST_FILE}${RESET}\n` +
      `\nRun ${BOLD}layout-context lint${RESET} to validate the imported kit.\n`,
  );
}

function buildLayoutMdSkeleton(
  projectName: string,
  grouped: Map<string, Array<{ name: string; value: string }>>,
): string {
  const lines: string[] = [];
  lines.push(`# ${projectName}`);
  lines.push("");
  lines.push("_Generated from tokens.json. Fill in the prose sections and delete this line._");
  lines.push("");
  lines.push("## Quick Reference");
  lines.push("");
  lines.push("```css");
  lines.push(":root {");
  for (const [, tokens] of grouped) {
    for (const t of tokens.slice(0, 4)) lines.push(`  ${t.name}: ${t.value};`);
  }
  lines.push("}");
  lines.push("```");
  lines.push("");

  for (const [category, tokens] of grouped) {
    lines.push(`## ${category}`);
    lines.push("");
    lines.push("```css");
    for (const t of tokens) lines.push(`${t.name}: ${t.value};`);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Components");
  lines.push("");
  lines.push("_Add component examples here. Keep each under 40 lines of TSX._");
  lines.push("");
  lines.push("## Anti-Patterns");
  lines.push("");
  lines.push("_List rules that AI agents must not violate when generating code._");
  lines.push("");

  return lines.join("\n");
}

function slugify(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported-kit";
}
