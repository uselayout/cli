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
import fs from "node:fs";
import path from "node:path";
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

/**
 * The dev-server port Next is (about to be) listening on. Next doesn't expose
 * it to `next.config`, so we read it the same way Next does: `-p`/`--port` on
 * the dev command, then `$PORT`, else the 3000 default. The CLI verifies the
 * server actually responds before binding, so a wrong guess is self-correcting.
 */
function devPort(): number {
  const argv = process.argv;
  const flag = argv.findIndex((a) => a === "-p" || a === "--port");
  if (flag >= 0) {
    const n = Number(argv[flag + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const env = Number(process.env.PORT);
  if (Number.isFinite(env) && env > 0) return env;
  return 3000;
}

let devInfoWritten = false;

/**
 * Advertise THIS project's dev server so `npx @layoutdesign/context live` binds
 * to it deterministically — even with several localhosts running. Mirrors the
 * Vite plugin's `writeDevInfo`. Best-effort: never throws, never blocks dev.
 * Written once on the first dev compile; removed on process exit.
 */
function writeNextDevInfo(root: string): void {
  if (devInfoWritten) return;
  // Escape hatch (tests / opt-out): skip the hint file entirely.
  if (process.env.LAYOUT_LIVE_NO_DEVINFO === "1") return;
  devInfoWritten = true;
  const infoPath = path.join(root, ".layout", "live", "dev-info.json");
  try {
    const port = devPort();
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(
      infoPath,
      JSON.stringify(
        {
          projectRoot: root,
          url: `http://localhost:${port}`,
          port,
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    const cleanup = () => {
      try {
        fs.rmSync(infoPath, { force: true });
      } catch {
        /* ignore */
      }
    };
    process.once("exit", cleanup);
    process.once("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
  } catch {
    /* never break the dev server over a hint file */
  }
}

/** True if the project uses the Next App Router (`app/` or `src/app/`). */
function isAppRouter(root: string): boolean {
  return (
    fs.existsSync(path.join(root, "app")) ||
    fs.existsSync(path.join(root, "src", "app"))
  );
}

let turbopackWarned = false;
let appRouterWarned = false;

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
        // Advertise this project's dev server for deterministic `live` binding.
        writeNextDevInfo(process.cwd());
        // App Router: the Babel tagging pass makes Next misclassify React
        // Server Components as client modules (a server component that exports
        // `metadata` then fails to build). Do NOT inject it on App Router —
        // that breaks the build, which is worse than no tagging. Source
        // tagging for App Router is moving to a native SWC plugin. dev-info is
        // still written above so `live` / the in-app switcher can bind.
        if (isAppRouter(process.cwd())) {
          if (!appRouterWarned) {
            appRouterWarned = true;
            console.warn(
              "[@layoutdesign/context] Next App Router detected — element " +
                "source tagging is paused here (the Babel pass conflicts with " +
                "React Server Components; native SWC tagging is in progress). " +
                "Your app builds normally; elements aren't editable in Layout " +
                "Live yet."
            );
          }
        } else {
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
      }
      // Defer to the user's own webpack override, if any.
      return typeof nextConfig.webpack === "function"
        ? nextConfig.webpack(config, options)
        : config;
    },
  };
}
