import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LAYOUT_DIR, TOKENS_CSS_FILE, TOKENS_JSON_FILE, LAYOUT_MD_FILE } from "../../kit/types.js";

export const name = "update-tokens";

export const description =
  "Update design token values in the active kit. Changes are applied to tokens.css, tokens.json, " +
  "and layout.md simultaneously so the design system stays consistent. Use this when the user wants " +
  "to tweak colours, spacing, typography, or other token values without re-extracting from Figma.";

export const inputSchema = {
  updates: z
    .array(
      z.object({
        token: z.string().describe("CSS variable name, e.g. --color-action-primary"),
        value: z.string().describe("New value, e.g. #FF0000 or 16px"),
      })
    )
    .describe("One or more token updates to apply"),
};

interface TokenResult {
  token: string;
  oldValue: string;
  newValue: string;
  css: boolean;
  json: string | null;
  mdCount: number;
}

export function handler() {
  return async ({ updates }: { updates: Array<{ token: string; value: string }> }) => {
    const dir = resolve(process.cwd(), LAYOUT_DIR);

    if (!existsSync(dir)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No .layout/ directory found. Run `npx @layoutdesign/context init` or import a Studio export first.",
          },
        ],
      };
    }

    const cssPath = join(dir, TOKENS_CSS_FILE);
    if (!existsSync(cssPath)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tokens.css found in .layout/. Cannot update tokens without a CSS token file.",
          },
        ],
      };
    }

    let css = readFileSync(cssPath, "utf-8");
    const jsonPath = join(dir, TOKENS_JSON_FILE);
    const mdPath = join(dir, LAYOUT_MD_FILE);

    let tokensJson: Record<string, unknown> | null = null;
    if (existsSync(jsonPath)) {
      try {
        tokensJson = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
      } catch {
        // Malformed JSON — skip
      }
    }

    let layoutMd: string | null = null;
    if (existsSync(mdPath)) {
      layoutMd = readFileSync(mdPath, "utf-8");
    }

    const results: TokenResult[] = [];
    const errors: string[] = [];

    for (const { token, value: newValue } of updates) {
      // Match the token in CSS: --token-name: <value>;
      const escapedToken = escapeForRegex(token);
      const pattern = new RegExp(`(${escapedToken}:\\s*)(.+?)(\\s*;)`, "g");
      const match = pattern.exec(css);

      if (!match) {
        errors.push(`Token "${token}" not found in tokens.css`);
        continue;
      }

      const oldValue = match[2]!.trim();

      if (normalizeValue(oldValue) === normalizeValue(newValue)) {
        errors.push(`Token "${token}" already has value "${newValue}"`);
        continue;
      }

      // Reset regex lastIndex and update CSS
      pattern.lastIndex = 0;
      css = css.replace(pattern, `$1${newValue}$3`);

      // Update tokens.json
      let jsonMatchPath: string | null = null;
      if (tokensJson) {
        jsonMatchPath = updateJsonToken(tokensJson, oldValue, newValue);
      }

      // Update layout.md
      let mdCount = 0;
      if (layoutMd && oldValue !== newValue) {
        const escapedOld = escapeForRegex(oldValue);
        // For hex colours, ensure we don't match partial (e.g. #5E6AD2 inside #5E6AD2FF)
        const mdPattern = isHexColour(oldValue)
          ? new RegExp(escapedOld + "(?![0-9a-fA-F])", "g")
          : new RegExp(escapedOld, "g");

        const matches = layoutMd.match(mdPattern);
        mdCount = matches?.length ?? 0;
        if (mdCount > 0) {
          layoutMd = layoutMd.replace(mdPattern, newValue);
        }
      }

      results.push({
        token,
        oldValue,
        newValue,
        css: true,
        json: jsonMatchPath,
        mdCount,
      });
    }

    // Write files back
    if (results.length > 0) {
      writeFileSync(cssPath, css);

      if (tokensJson) {
        writeFileSync(jsonPath, JSON.stringify(tokensJson, null, 2) + "\n");
      }

      if (layoutMd) {
        writeFileSync(mdPath, layoutMd);
      }
    }

    // Build response
    const lines: string[] = [];

    if (results.length > 0) {
      lines.push(`Updated ${results.length} token${results.length === 1 ? "" : "s"}:\n`);

      for (const r of results) {
        lines.push(`  ${r.token}: ${r.oldValue} → ${r.newValue}`);
        lines.push(`    ✓ tokens.css`);
        if (r.json) {
          lines.push(`    ✓ tokens.json (${r.json})`);
        } else if (tokensJson) {
          lines.push(`    ⚠ tokens.json (no matching $value found)`);
        }
        if (r.mdCount > 0) {
          lines.push(`    ✓ layout.md (${r.mdCount} occurrence${r.mdCount === 1 ? "" : "s"})`);
        } else if (layoutMd) {
          lines.push(`    – layout.md (old value not found in text)`);
        }
      }
    }

    if (errors.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Skipped:");
      for (const e of errors) {
        lines.push(`  ⚠ ${e}`);
      }
    }

    if (results.length === 0 && errors.length === 0) {
      lines.push("No updates provided.");
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  };
}

/**
 * Walk the JSON tree looking for objects with `$value` matching oldValue.
 * Returns the dot-path of the first match, or null.
 */
function updateJsonToken(
  obj: Record<string, unknown>,
  oldValue: string,
  newValue: string,
  pathParts: string[] = []
): string | null {
  let foundPath: string | null = null;

  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;

      if ("$value" in record && typeof record["$value"] === "string") {
        if (normalizeValue(record["$value"]) === normalizeValue(oldValue)) {
          record["$value"] = newValue;
          foundPath = [...pathParts, key].join(".");
        }
      } else if ("$value" in record && Array.isArray(record["$value"])) {
        // fontFamily arrays — skip value matching for arrays
      } else {
        const result = updateJsonToken(record, oldValue, newValue, [...pathParts, key]);
        if (result && !foundPath) foundPath = result;
      }
    }
  }

  return foundPath;
}

function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeValue(val: string): string {
  return val.trim().replace(/\s+/g, " ").toLowerCase();
}

function isHexColour(val: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(val.trim());
}
