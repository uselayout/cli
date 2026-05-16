/**
 * `@layoutdesign/context/vite-plugin`
 *
 * Injects layout source-location attributes into JSX during the Vite dev
 * server build. No-op in production builds (`apply: 'serve'` + the transform's
 * own NODE_ENV guard). Place this *before* `@vitejs/plugin-react`.
 *
 *   import layout from '@layoutdesign/context/vite-plugin';
 *   export default defineConfig({ plugins: [layout(), react()] });
 *
 * `vite` is an optional peer — we don't import its types so the package builds
 * and ships without vite installed. The returned object is structurally a
 * Vite `Plugin`.
 */
import { transformWithLayoutAttrs } from "../transform.js";

export interface LayoutVitePluginOptions {
  /** Globs/patterns to include. Default: all .tsx/.jsx. */
  include?: string | string[];
  /** Substrings/patterns to exclude. Default: node_modules. */
  exclude?: string | string[];
  /** Force-enable in production (not recommended). Default: false. */
  production?: boolean;
}

/** Minimal structural shape of the bits of a Vite plugin we use. */
interface VitePluginLike {
  name: string;
  enforce: "pre";
  apply: "serve";
  configResolved(config: { root?: string }): void;
  transform(
    code: string,
    id: string
  ): { code: string; map: object | null } | null;
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default function layout(
  options: LayoutVitePluginOptions = {}
): VitePluginLike {
  const exclude = toArray(options.exclude);
  const defaultExcluded = (id: string) => id.includes("node_modules");
  const include = toArray(options.include);
  let root = process.cwd();

  return {
    name: "@layoutdesign/context/vite-plugin",
    enforce: "pre",
    apply: "serve",
    configResolved(config) {
      if (config?.root) root = config.root;
    },
    transform(code, id) {
      const clean = id.split("?")[0] ?? id;
      if (!/\.(tsx|jsx)$/.test(clean)) return null;
      if (defaultExcluded(clean)) return null;
      if (exclude.some((p) => clean.includes(p))) return null;
      if (include.length > 0 && !include.some((p) => clean.includes(p))) {
        return null;
      }
      const result = transformWithLayoutAttrs(code, clean, root, {
        production: options.production,
      });
      // transformWithLayoutAttrs returns the input untouched with map:null
      // when nothing changed — signal "no change" to Vite to keep its maps.
      if (result.code === code && result.map === null) return null;
      return result;
    },
  };
}
