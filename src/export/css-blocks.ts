/**
 * Shared CSS block scanner for kit token stylesheets.
 *
 * Lives here so every parser that needs to know what "dark" means
 * (update-tokens, kit-tokens, list-tokens, the suggestion engine) shares a
 * single definition and the dark-detection paths cannot drift.
 */

/** Selectors (or @media conditions) that mark a block as dark-mode. Mirrors
 *  the shapes Studio's tokens.css generator emits: `[data-theme="dark"]`,
 *  `.dark`, and `@media (prefers-color-scheme: dark)`. */
export const DARK_BLOCK =
  /data-theme\s*=\s*['"]?dark['"]?|\.dark(?![\w-])|prefers-color-scheme\s*:\s*dark/i;

export interface CssBlock {
  /** Index range of the block BODY (between its braces). Innermost blocks
   *  only: an @media wrapper contributes its condition to the darkness of
   *  the blocks nested inside it, never a body of its own. */
  bodyStart: number;
  bodyEnd: number;
  dark: boolean;
}

/**
 * Split a token stylesheet into its innermost declaration blocks via brace
 * matching, classifying each as base (light) or dark-mode. Handles the
 * generated shapes: flat `:root { }`, `[data-theme="dark"] { }`, `.dark { }`
 * and `@media (prefers-color-scheme: dark) { :root { } }` nesting.
 * Deliberately simple: kit token files are generated CSS without braces in
 * comments or strings.
 */
export function parseCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const stack: Array<{ selector: string; bodyStart: number; hasChild: boolean }> = [];
  let segStart = 0; // start of the text that will become the next selector
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      const selector = css.slice(segStart, i).trim();
      const parent = stack[stack.length - 1];
      if (parent) parent.hasChild = true;
      stack.push({ selector, bodyStart: i + 1, hasChild: false });
      segStart = i + 1;
    } else if (ch === "}") {
      const top = stack.pop();
      if (top && !top.hasChild) {
        const dark =
          DARK_BLOCK.test(top.selector) ||
          stack.some((s) => DARK_BLOCK.test(s.selector));
        blocks.push({ bodyStart: top.bodyStart, bodyEnd: i, dark });
      }
      segStart = i + 1;
    } else if (ch === ";") {
      // Declarations end here: the next selector starts after this point.
      segStart = i + 1;
    }
  }
  return blocks;
}
