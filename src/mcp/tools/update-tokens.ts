import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LAYOUT_DIR, TOKENS_CSS_FILE, TOKENS_JSON_FILE, LAYOUT_MD_FILE } from "../../kit/types.js";
import { parseCssBlocks } from "../../export/css-blocks.js";

export const name = "update-tokens";

export const description =
  "Update design token values in the active kit. Changes are applied to tokens.css, tokens.json, " +
  "and layout.md simultaneously so the design system stays consistent. Use this when the user wants " +
  "to tweak colours, spacing, typography, or other token values without re-extracting from Figma.";

export type UpdateMode = "light" | "dark" | "all";

export const inputSchema = {
  updates: z
    .array(
      z.object({
        token: z.string().describe("CSS variable name, e.g. --color-action-primary"),
        value: z.string().describe("New value, e.g. #FF0000 or 16px"),
        mode: z
          .enum(["light", "dark", "all"])
          .default("light")
          .describe(
            'Which theme block to update: "light" = the base :root block only (default), ' +
              '"dark" = dark-mode blocks ([data-theme="dark"], .dark, @media prefers-color-scheme: dark), ' +
              '"all" = every occurrence.'
          ),
      })
    )
    .describe("One or more token updates to apply"),
};

interface TokenResult {
  token: string;
  mode: UpdateMode;
  oldValue: string;
  newValue: string;
  css: boolean;
  json: string | null;
  mdCount: number;
}

// Block scanning and dark-mode classification are shared with the token
// parsers (kit-tokens.ts, list-tokens) via css-blocks.ts, so what counts as
// "dark" is defined exactly once. Re-exported for existing importers.
export { parseCssBlocks } from "../../export/css-blocks.js";

export type CssReplaceResult =
  | { ok: true; css: string; oldValue: string; replaced: number }
  | { ok: false; reason: "not-found" | "not-in-mode" | "unchanged"; oldValue?: string };

/**
 * Replace `token`'s value within the blocks matching `mode` only.
 * "light" targets base blocks, "dark" targets dark-mode blocks (including the
 * @media prefers-color-scheme duplicate), "all" targets every occurrence.
 */
export function replaceTokenInCss(
  css: string,
  token: string,
  newValue: string,
  mode: UpdateMode
): CssReplaceResult {
  const blocks = parseCssBlocks(css);
  const declRe = new RegExp(
    `(?<![\\w-])(${escapeForRegex(token)}\\s*:\\s*)([^;{}]+);`,
    "g"
  );
  interface Hit {
    valueStart: number;
    valueEnd: number;
    value: string;
    dark: boolean;
  }
  const all: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(css)) !== null) {
    const idx = m.index;
    const valueStart = idx + m[1]!.length;
    const block = blocks.find((b) => idx >= b.bodyStart && idx < b.bodyEnd);
    if (!block) continue; // not a declaration inside any block
    all.push({
      valueStart,
      valueEnd: valueStart + m[2]!.length,
      value: m[2]!.trim(),
      dark: block.dark,
    });
  }

  if (all.length === 0) return { ok: false, reason: "not-found" };

  const targets =
    mode === "all" ? all : all.filter((h) => h.dark === (mode === "dark"));
  if (targets.length === 0) return { ok: false, reason: "not-in-mode" };

  // Only occurrences whose value actually differs get rewritten. "Unchanged"
  // means EVERY targeted occurrence already matches: with mode "all" the
  // base value may already match while the dark blocks differ, and aborting
  // on the first occurrence alone would leave those dark blocks untouched.
  const changed = targets.filter(
    (t) => normalizeValue(t.value) !== normalizeValue(newValue)
  );
  if (changed.length === 0) {
    return { ok: false, reason: "unchanged", oldValue: targets[0]!.value };
  }

  let out = css;
  for (const t of [...changed].sort((a, b) => b.valueStart - a.valueStart)) {
    out = out.slice(0, t.valueStart) + newValue + out.slice(t.valueEnd);
  }
  // oldValue is the first value that actually changed: it feeds the
  // tokens.json / layout.md sync, which must chase the replaced value.
  return { ok: true, css: out, oldValue: changed[0]!.value, replaced: changed.length };
}

export function handler() {
  return async ({
    updates,
  }: {
    updates: Array<{ token: string; value: string; mode?: UpdateMode }>;
  }) => {
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

    for (const { token, value: newValue, mode: rawMode } of updates) {
      const mode: UpdateMode = rawMode ?? "light";
      const res = replaceTokenInCss(css, token, newValue, mode);

      if (!res.ok) {
        if (res.reason === "not-found") {
          errors.push(`Token "${token}" not found in tokens.css`);
        } else if (res.reason === "not-in-mode") {
          errors.push(`Token "${token}" (${mode}) not found in tokens.css`);
        } else {
          errors.push(`Token "${token}" already has value "${newValue}"`);
        }
        continue;
      }

      css = res.css;
      const oldValue = res.oldValue;

      // Update tokens.json: when the file carries a mode dimension, only
      // entries whose $extensions.mode matches the requested mode are
      // eligible; there is NO cross-mode fallback, because matching by
      // $value alone could rewrite an unrelated entry from the other mode
      // that happens to share the old value, silently desyncing tokens.json
      // from tokens.css. A miss is reported as a miss instead. Files
      // without a mode dimension match by value as before.
      let jsonMatchPath: string | null = null;
      if (tokensJson) {
        if (mode !== "all" && jsonHasModeDimension(tokensJson)) {
          const filter = (entryMode: string | undefined): boolean =>
            mode === "dark" ? entryMode === "dark" : entryMode !== "dark";
          jsonMatchPath = updateJsonToken(tokensJson, oldValue, newValue, [], filter);
        } else {
          jsonMatchPath = updateJsonToken(tokensJson, oldValue, newValue);
        }
      }

      // Update layout.md: light/all only. Dark values rarely appear in the
      // prose, and a blind replace would corrupt light-value mentions.
      let mdCount = 0;
      if (layoutMd && mode !== "dark" && oldValue !== newValue) {
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
        mode,
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
        lines.push(
          r.mode === "light"
            ? `    ✓ tokens.css`
            : `    ✓ tokens.css (${r.mode === "dark" ? "dark blocks" : "all blocks"})`
        );
        if (r.json) {
          lines.push(`    ✓ tokens.json (${r.json})`);
        } else if (tokensJson) {
          lines.push(`    ⚠ tokens.json (no matching $value found)`);
        }
        if (r.mode === "dark") {
          if (layoutMd) lines.push(`    – layout.md (dark values not synced to prose)`);
        } else if (r.mdCount > 0) {
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

/** Whether any token in the tree carries a $extensions.mode dimension. */
function jsonHasModeDimension(obj: Record<string, unknown>): boolean {
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      const ext = record["$extensions"];
      if (
        ext &&
        typeof ext === "object" &&
        typeof (ext as Record<string, unknown>)["mode"] === "string"
      ) {
        return true;
      }
      if (jsonHasModeDimension(record)) return true;
    }
  }
  return false;
}

/** The $extensions.mode of a DTCG token node, when present. */
function nodeMode(record: Record<string, unknown>): string | undefined {
  const ext = record["$extensions"];
  if (ext && typeof ext === "object") {
    const m = (ext as Record<string, unknown>)["mode"];
    if (typeof m === "string") return m;
  }
  return undefined;
}

/**
 * Walk the JSON tree looking for objects with `$value` matching oldValue
 * (optionally filtered by their $extensions.mode). Returns the dot-path of
 * the first match, or null.
 */
function updateJsonToken(
  obj: Record<string, unknown>,
  oldValue: string,
  newValue: string,
  pathParts: string[] = [],
  modeFilter?: (mode: string | undefined) => boolean
): string | null {
  let foundPath: string | null = null;

  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;

      if ("$value" in record && typeof record["$value"] === "string") {
        if (
          normalizeValue(record["$value"]) === normalizeValue(oldValue) &&
          (!modeFilter || modeFilter(nodeMode(record)))
        ) {
          record["$value"] = newValue;
          foundPath = [...pathParts, key].join(".");
        }
      } else if ("$value" in record && Array.isArray(record["$value"])) {
        // fontFamily arrays — skip value matching for arrays
      } else {
        const result = updateJsonToken(
          record,
          oldValue,
          newValue,
          [...pathParts, key],
          modeFilter
        );
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
