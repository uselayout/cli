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
import { resolveSwcDecision, swcMode } from "./swc.js";

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
  experimental?: { swcPlugins?: unknown[]; [key: string]: unknown };
  turbopack?: Record<string, unknown>;
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
let swcActiveLogged = false;

const PFX = "[@layoutdesign/context]";

/** The "App Router tagging is paused" message, tailored to WHY so the user
 *  knows what (if anything) to do. Native tagging is on by default; it only
 *  pauses when explicitly disabled or when we don't ship a wasm for their Next. */
function appRouterMessage(reason: string): string {
  const base =
    `${PFX} Next App Router detected — element source tagging is paused. `;
  if (reason === "off") {
    return (
      base +
      "It's disabled (LAYOUT_LIVE_SWC=0). Remove that to re-enable native " +
      "tagging. Your app builds normally."
    );
  }
  if (reason.startsWith("abi-unsupported")) {
    const [, nextV, swc] = reason.split(":");
    return (
      base +
      `Your Next ${nextV} bundles ${swc}, which Layout doesn't ship a native ` +
      "plugin for yet (supported: Next 15.5.x and 16.2.x). Skipped safely — " +
      "your app builds normally. Pin a supported Next for native tagging, or " +
      "set LAYOUT_LIVE_SWC=force to try anyway (at your own risk)."
    );
  }
  if (reason.startsWith("abi-unknown")) {
    const nextV = reason.split(":")[1];
    return (
      base +
      `Couldn't match your Next ${nextV} to a known SWC ABI, so native tagging ` +
      "is skipped (safer than risking a broken build). Set LAYOUT_LIVE_SWC=" +
      "force to try anyway."
    );
  }
  if (reason === "wasm-missing") {
    return (
      base +
      "The prebuilt plugin wasm wasn't found in the installed package, so " +
      "native tagging is unavailable."
    );
  }
  return base + "Your app builds normally regardless.";
}

export default function withLayout(
  nextConfig: NextConfigLike = {}
): NextConfigLike {
  const root = process.cwd();
  const appRouter = isAppRouter(root);
  // Next sets NODE_ENV=development for `next dev`, production for `next build`.
  // Keep tagging dev-only, matching transform.ts's shouldTransform().
  const isDev = process.env.NODE_ENV !== "production";
  // Native SWC tagging (App Router + Turbopack). Opt-in via LAYOUT_LIVE_SWC=1
  // (guarded: injects only when the installed Next's swc_core matches the
  // shipped wasm) or `=force`. The version guard means a wrong Next gives a
  // clean skip + warning here, never a hard build failure. See ./swc.ts.
  const swcDecision =
    appRouter && isDev
      ? resolveSwcDecision(root)
      : { entry: null, reason: "n/a" };
  const swcEntry = swcDecision.entry;

  // Turbopack (`next dev --turbo`) ignores the `webpack()` hook. App Router is
  // handled by the native SWC plugin (or its tailored skip message below), so
  // only warn here for Pages Router under Turbopack, where the Babel path is
  // the only option and Turbopack bypasses it.
  if (process.env.TURBOPACK && !appRouter && !turbopackWarned) {
    turbopackWarned = true;
    console.warn(
      `${PFX} Turbopack detected — layout Live source tagging needs webpack. ` +
        "Run `next dev` without --turbo for the visual-edit loop."
    );
  }

  // Advertise this project's dev server for deterministic `live` binding. Done
  // at config-load (dev only) rather than inside webpack() so it ALSO runs under
  // Turbopack (which ignores the webpack hook) — e.g. Next 16, Turbopack-default.
  if (isDev) writeNextDevInfo(root);

  const out: NextConfigLike = {
    ...nextConfig,
    // Next 16 builds with Turbopack by default and HARD-ERRORS when a `webpack`
    // config is present without a `turbopack` config. We always carry a webpack
    // hook (for Pages Router Babel tagging / user composition), so provide a
    // turbopack config (merging any the user set) to keep `next build` working.
    turbopack: { ...(nextConfig.turbopack ?? {}) },
    webpack(config: WebpackConfigLike, options: WebpackOptions) {
      if (options.dev) {
        // App Router: the Babel tagging pass makes Next misclassify React
        // Server Components as client modules (a server component that exports
        // `metadata` then fails to build). NEVER inject the Babel rule on App
        // Router. Tagging there is handled by the native SWC plugin (below) when
        // opted-in; otherwise it's paused (app still builds normally).
        if (appRouter) {
          if (swcEntry) {
            if (!swcActiveLogged) {
              swcActiveLogged = true;
              console.log(
                "[@layoutdesign/context] App Router — native SWC source " +
                  "tagging active (works under webpack and Turbopack)."
              );
            }
          } else if (!appRouterWarned) {
            appRouterWarned = true;
            console.warn(appRouterMessage(swcDecision.reason));
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

  // App Router native tagging: add our plugin to experimental.swcPlugins,
  // preserving any the user already configured. This is a top-level config key
  // (not inside webpack()), and applies under Turbopack too.
  if (swcEntry) {
    const exp: { swcPlugins?: unknown[]; [k: string]: unknown } = {
      ...(nextConfig.experimental ?? {}),
    };
    const existing = Array.isArray(exp.swcPlugins) ? exp.swcPlugins : [];
    exp.swcPlugins = [...existing, swcEntry];
    out.experimental = exp;
  }

  return out;
}

/** Exposed for diagnostics/preflight: WILL native SWC tagging actually inject
 *  for this project? True only when enabled, App Router, and the version guard
 *  passes (or force) — i.e. when we'd really add the swcPlugins entry. */
export function swcTaggingReady(root: string): boolean {
  return (
    swcMode() !== "off" &&
    isAppRouter(root) &&
    resolveSwcDecision(root).entry !== null
  );
}
