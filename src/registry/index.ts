/**
 * Layout UI component registry — pure logic for the `add` command.
 *
 * This module is deliberately free of filesystem and process side-effects so it
 * can be unit-tested in isolation. It handles:
 *   - fetching + recursively resolving registry items (with a fetch you pass in)
 *   - rewriting `@/registry/layout/*` and `@/lib/utils` imports to project aliases
 *   - merging cssVars into an existing global stylesheet, idempotently
 *
 * The registry format is shadcn's registry-item schema, served from
 * https://ui.staging.layout.design/r (or LAYOUT_REGISTRY).
 */

/** Default registry base. Flip to https://layout.design/r on GA — one line. */
export const DEFAULT_REGISTRY = "https://ui.staging.layout.design/r";

/** Resolve the registry base URL: --registry flag > LAYOUT_REGISTRY env > default. */
export function resolveRegistryBase(flag?: string): string {
  const base = flag ?? process.env.LAYOUT_REGISTRY ?? DEFAULT_REGISTRY;
  return base.replace(/\/+$/, "");
}

export interface RegistryFile {
  path: string;
  content?: string;
  type?: string;
  /** Optional explicit destination (shadcn `target`). Relative to project root. */
  target?: string;
}

export interface RegistryItemCssVars {
  theme?: Record<string, string>;
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

export interface RegistryItemMeta {
  /** One-paragraph "when to use" guidance. */
  usage?: string;
  /** Hard rules the component must not break. */
  never?: string[];
  /** Design tokens the component consumes. */
  tokens?: string[];
  [key: string]: unknown;
}

export interface RegistryItem {
  name: string;
  type?: string;
  title?: string;
  description?: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  files?: RegistryFile[];
  cssVars?: RegistryItemCssVars;
  meta?: RegistryItemMeta;
}

/** The shape served at `<registry>/registry.json` (shadcn registry schema). */
export interface RegistryIndex {
  name?: string;
  homepage?: string;
  items: RegistryItem[];
}

/** A fetcher returning parsed JSON, injected so tests can mock the network. */
export type ItemFetcher = (ref: RegistryRef) => Promise<RegistryItem | null>;

export interface RegistryRef {
  /** How to fetch: our registry by name, or a full URL. */
  kind: "name" | "url";
  /** Item name (for kind === "name") or absolute URL (for kind === "url"). */
  value: string;
}

/**
 * Classify a registryDependencies entry into how it should be resolved.
 *   - "utils"           -> local, we generate lib/utils.ts (never fetched)
 *   - "@layout/button"  -> our registry, item "button"
 *   - "http(s)://..."   -> full URL, fetched directly
 *   - "button"          -> bare name, try our registry
 */
export function classifyDependency(
  dep: string
):
  | { kind: "utils" }
  | { kind: "name"; name: string }
  | { kind: "url"; url: string } {
  if (dep === "utils") return { kind: "utils" };
  if (/^https?:\/\//i.test(dep)) return { kind: "url", url: dep };
  if (dep.startsWith("@layout/")) {
    return { kind: "name", name: dep.slice("@layout/".length) };
  }
  // Any other bare name (or unknown scope) — try our registry by name.
  const withoutScope = dep.includes("/") ? dep.split("/").pop()! : dep;
  return { kind: "name", name: withoutScope };
}

export interface ResolveResult {
  /** Resolved items in install order (dependencies before dependents). */
  items: RegistryItem[];
  /** Whether the `utils` helper (lib/utils.ts) is required. */
  needsUtils: boolean;
  /** Bare/unknown deps we could not resolve (already-warned callers). */
  unresolved: string[];
}

/**
 * Recursively resolve requested item names into a de-duplicated, dependency-first
 * ordered list. `fetchItem` performs the actual network/mock retrieval.
 *
 * Ordering guarantee: an item's registry dependencies always appear before the
 * item itself, so writing files/installing in array order is safe. Cycles are
 * broken by an in-progress set (an item is never entered twice).
 */
export async function resolveItems(
  names: string[],
  fetchItem: ItemFetcher
): Promise<ResolveResult> {
  const ordered: RegistryItem[] = [];
  const seen = new Set<string>(); // completed
  const inProgress = new Set<string>(); // on the current DFS stack (cycle guard)
  let needsUtils = false;
  const unresolved: string[] = [];

  async function visitRef(ref: RegistryRef, key: string): Promise<void> {
    if (seen.has(key) || inProgress.has(key)) return;
    inProgress.add(key);

    const item = await fetchItem(ref);
    if (!item) {
      unresolved.push(ref.value);
      inProgress.delete(key);
      return;
    }

    // Resolve dependencies first so they land earlier in `ordered`.
    for (const dep of item.registryDependencies ?? []) {
      const c = classifyDependency(dep);
      if (c.kind === "utils") {
        needsUtils = true;
      } else if (c.kind === "name") {
        await visitRef({ kind: "name", value: c.name }, `name:${c.name}`);
      } else {
        await visitRef({ kind: "url", value: c.url }, `url:${c.url}`);
      }
    }

    if (!seen.has(key)) {
      ordered.push(item);
      seen.add(key);
    }
    inProgress.delete(key);
  }

  for (const name of names) {
    await visitRef({ kind: "name", value: name }, `name:${name}`);
  }

  return { items: ordered, needsUtils, unresolved };
}

/**
 * Rewrite import specifiers inside a component file so they resolve against the
 * consuming project's aliases rather than the registry's internal layout.
 *
 *   @/registry/layout/<x>/<x>  ->  <componentAlias>/<x>
 *   @/lib/utils                ->  <utilsAlias>
 *
 * `componentAlias` defaults to "@/components/ui" and `utilsAlias` to "@/lib/utils".
 * Only these two shapes appear in Layout UI items today; anything else is left
 * untouched.
 */
export function rewriteImports(
  content: string,
  opts: { componentAlias?: string; utilsAlias?: string } = {}
): string {
  const componentAlias = (opts.componentAlias ?? "@/components/ui").replace(
    /\/+$/,
    ""
  );
  const utilsAlias = opts.utilsAlias ?? "@/lib/utils";

  return (
    content
      // @/registry/layout/button/button  ->  @/components/ui/button
      // Keep only the final component segment; drop the nested folder path.
      .replace(
        /@\/registry\/layout\/[^/"'`\s]+\/([^/"'`\s]+)/g,
        (_m, file: string) => `${componentAlias}/${file}`
      )
      // @/lib/utils -> configured utils alias (exact, avoids matching utils-foo)
      .replace(/@\/lib\/utils(?=["'`])/g, utilsAlias)
  );
}

/** The canonical shadcn `cn` helper, generated locally for the `utils` dep. */
export const UTILS_FILE_CONTENT = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

/** npm deps the generated lib/utils.ts requires. */
export const UTILS_DEPENDENCIES = ["clsx", "tailwind-merge"];

/**
 * Given a set of "prop: value" pairs and an existing CSS block body, return a
 * new block body that upserts each var: existing same-named declarations are
 * replaced in place, new ones are appended. Idempotent — running twice with the
 * same vars yields identical output. `indent` is the leading whitespace for
 * appended declarations.
 */
export function upsertDeclarations(
  existingBody: string,
  vars: Record<string, string>,
  indent = "  "
): string {
  let body = existingBody;
  const appended: string[] = [];

  for (const [rawName, value] of Object.entries(vars)) {
    const name = rawName.startsWith("--") ? rawName : `--${rawName}`;
    const decl = `${name}: ${value};`;
    // Match an existing declaration for this exact custom property.
    const re = new RegExp(
      `(^|\\n)([ \\t]*)${escapeRegExp(name)}\\s*:\\s*[^;\\n]*;`,
      "m"
    );
    if (re.test(body)) {
      body = body.replace(re, (_m, lead: string, ws: string) => `${lead}${ws}${decl}`);
    } else {
      appended.push(`${indent}${decl}`);
    }
  }

  if (appended.length > 0) {
    // Ensure a trailing newline before appending, then the new declarations.
    const trimmed = body.replace(/\s*$/, "");
    body = `${trimmed}\n${appended.join("\n")}\n`;
  }
  return body;
}

/**
 * Inject a set of vars into a named top-level block (e.g. ":root", ".dark",
 * "@theme inline") within a stylesheet. If the block does not exist, it is
 * created at the end of the file. Merging is idempotent.
 */
export function injectBlock(
  css: string,
  selector: string,
  vars: Record<string, string>
): string {
  if (Object.keys(vars).length === 0) return css;

  const block = findBlock(css, selector);
  if (block) {
    const newBody = upsertDeclarations(block.body, vars, block.indent);
    return css.slice(0, block.bodyStart) + newBody + css.slice(block.bodyEnd);
  }

  // Create the block at the end of the file.
  const decls = Object.entries(vars)
    .map(([rawName, value]) => {
      const name = rawName.startsWith("--") ? rawName : `--${rawName}`;
      return `  ${name}: ${value};`;
    })
    .join("\n");
  const prefix = css.replace(/\s*$/, "");
  const sep = prefix.length > 0 ? "\n\n" : "";
  return `${prefix}${sep}${selector} {\n${decls}\n}\n`;
}

interface FoundBlock {
  body: string;
  indent: string;
  bodyStart: number;
  bodyEnd: number;
}

/** Locate a top-level `<selector> { ... }` block and return its body span. */
function findBlock(css: string, selector: string): FoundBlock | null {
  const selRe = new RegExp(`${escapeRegExp(selector)}\\s*\\{`, "g");
  const m = selRe.exec(css);
  if (!m) return null;

  const open = m.index + m[0].length; // char after "{"
  // Find the matching closing brace, accounting for nesting.
  let depth = 1;
  let i = open;
  for (; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null; // unbalanced — bail rather than corrupt

  const body = css.slice(open, i);
  const indentMatch = body.match(/\n([ \t]+)\S/);
  const indent = indentMatch?.[1] ?? "  ";
  return { body, indent, bodyStart: open, bodyEnd: i };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Derive the destination filename for a registry file. The registry paths look
 * like `registry/layout/button/button.tsx`; we install to `<dir>/button.tsx`.
 * If the file carries an explicit `target`, its basename is used instead.
 */
export function destFileName(file: RegistryFile): string {
  const source = file.target ?? file.path;
  const segments = source.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? source;
}
