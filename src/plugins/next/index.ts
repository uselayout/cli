/**
 * `@layoutdesign/context/next-plugin`
 *
 * Next.js config HOC. Adds a dev-only webpack rule that runs the shared
 * layout Babel transform on .tsx/.jsx files (Option A from the spec — Babel
 * via webpack; SWC plugin is a future v1.1 item). No-op in production.
 *
 *   import withLayout from '@layoutdesign/context/next-plugin';
 *   export default withLayout({ /* ...next config *\/ });
 *
 * Composes cleanly with an existing user `webpack(config, options)` override:
 * we mutate the config, then defer to the user's function if present.
 *
 * `next`/`webpack` are optional peers — types are kept structural so the
 * package builds and ships without them installed.
 */
import { fileURLToPath } from "node:url";

type WebpackRule = {
  test: RegExp;
  exclude?: RegExp;
  use: unknown[];
};

interface WebpackConfigLike {
  module?: { rules?: WebpackRule[] };
}

interface WebpackOptions {
  dev: boolean;
  defaultLoaders?: { babel?: unknown };
}

export interface NextConfigLike {
  webpack?: (
    config: WebpackConfigLike,
    options: WebpackOptions
  ) => WebpackConfigLike;
  [key: string]: unknown;
}

/** Absolute path to the compiled babel-loader, resolved relative to here. */
function babelLoaderPath(): string {
  return fileURLToPath(new URL("./babel-loader.js", import.meta.url));
}

let turbopackWarned = false;

export default function withLayout(
  nextConfig: NextConfigLike = {}
): NextConfigLike {
  // Turbopack (`next dev --turbo`, default in newer Next) ignores the
  // `webpack()` hook, so the dev tagging below never runs and layout Live
  // would silently fail to resolve elements. Make that explicit once
  // rather than silent. Native Turbopack/SWC tagging is tracked separately.
  if (process.env.TURBOPACK && !turbopackWarned) {
    turbopackWarned = true;
    console.warn(
      "[@layoutdesign/context] Turbopack detected — layout Live source " +
        "tagging needs webpack. Run `next dev` without --turbo for the " +
        "visual-edit loop (Turbopack support is tracked, not yet shipped)."
    );
  }
  return {
    ...nextConfig,
    webpack(config: WebpackConfigLike, options: WebpackOptions) {
      if (options.dev) {
        config.module ??= {};
        config.module.rules ??= [];
        const use: unknown[] = [];
        if (options.defaultLoaders?.babel) {
          use.push(options.defaultLoaders.babel);
        }
        use.push({ loader: babelLoaderPath() });
        config.module.rules.push({
          test: /\.(tsx|jsx)$/,
          exclude: /node_modules/,
          use,
        });
      }
      // Defer to the user's own webpack override, if any.
      return typeof nextConfig.webpack === "function"
        ? nextConfig.webpack(config, options)
        : config;
    },
  };
}
