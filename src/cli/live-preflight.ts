/**
 * Pre-launch readiness check for `npx @layoutdesign/context live`.
 *
 * Layout Live can only select/edit elements that carry source tags
 * (`data-layout-source-file`), and those are injected by THIS project's dev
 * server via the layout build plugin. A fresh project usually has none — the
 * plugin isn't wired, or (on Next 15) the dev server runs Turbopack, which
 * bypasses the webpack-based plugin. Either way the canvas opens dead.
 *
 * This module makes that state visible BEFORE opening, and (with consent)
 * fixes it: wires the plugin and drops `--turbopack` from the dev script, then
 * tells the user to restart their dev server. Falls back to exact copy-paste
 * instructions when it can't auto-configure (unknown framework / non-TTY).
 */
import readline from "node:readline/promises";
import chalk from "chalk";
import {
  detectFramework,
  isPluginWired,
  installPlugin,
  ensureDependency,
  ensureLayoutLiveDir,
  fixTurbopackDevScript,
  type Framework,
} from "../install/live.js";

const SOURCE_TAG = "data-layout-source-file";

export interface PreflightOptions {
  /** Auto-accept file edits without prompting. */
  yes?: boolean;
  /** Treat as a TTY (tests). Default: process.stdin.isTTY. */
  interactive?: boolean;
  /** Injectable confirm (tests). */
  confirm?: (question: string) => Promise<boolean>;
  /** Injectable source-tag handshake (tests). */
  probeTags?: (url: string) => Promise<boolean>;
}

export interface PreflightResult {
  /** The served HTML already carried source tags — nothing to do. */
  hadTags: boolean;
  framework: Framework;
  /** We patched the build config this run. */
  wiredPlugin: boolean;
  /** We removed --turbopack from the dev script this run. */
  fixedTurbopack: boolean;
  /** The user must restart their dev server for tags to appear. */
  needsRestart: boolean;
}

/** Fetch `url` and report whether the served HTML carries source tags. */
export async function htmlHasSourceTags(
  url: string,
  timeoutMs = 1500
): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    const body = await res.text();
    return body.includes(SOURCE_TAG);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`${question} ${chalk.dim("[Y/n]")} `))
      .trim()
      .toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function printManualSetup(framework: Framework): void {
  console.log(chalk.bold("\n  To make elements editable, add the dev plugin:"));
  if (framework === "vite") {
    console.log(
      chalk.dim(
        `    // vite.config.ts\n` +
          `    import layout from "@layoutdesign/context/vite-plugin";\n` +
          `    export default defineConfig({ plugins: [layout(), react()] });`
      )
    );
  } else if (framework === "next") {
    console.log(
      chalk.dim(
        `    // next.config.ts\n` +
          `    import withLayout from "@layoutdesign/context/next-plugin";\n` +
          `    export default withLayout({ /* your config */ });\n` +
          `\n  Then run the dev server WITHOUT Turbopack:\n` +
          `    next dev        ${chalk.reset(chalk.dim("(not: next dev --turbopack)"))}`
      )
    );
  } else {
    console.log(
      chalk.dim(
        `    Vite:  import layout from "@layoutdesign/context/vite-plugin"  → plugins: [layout(), react()]\n` +
          `    Next:  import withLayout from "@layoutdesign/context/next-plugin"  → export default withLayout({...})\n` +
          `           and run \`next dev\` without --turbopack`
      )
    );
  }
  console.log(
    chalk.dim(
      `\n  Or let the CLI do it: ${chalk.cyan("npx @layoutdesign/context install --live")}`
    )
  );
}

/**
 * Ensure the dev server at `devUrl` will emit source tags. Returns a summary;
 * `live` continues to open the app regardless (per design), but prints clear
 * restart guidance when a fix was applied.
 */
export async function preflightSourceTags(
  projectRoot: string,
  devUrl: string,
  opts: PreflightOptions = {}
): Promise<PreflightResult> {
  const framework = detectFramework(projectRoot);
  const probeTags = opts.probeTags ?? ((u: string) => htmlHasSourceTags(u));

  const result: PreflightResult = {
    hadTags: false,
    framework,
    wiredPlugin: false,
    fixedTurbopack: false,
    needsRestart: false,
  };

  // 1. SSR frameworks (Next) stamp tags into the served HTML — the truth
  //    signal. A Vite SPA serves only a shell, so absence there is expected;
  //    fall back to the config-wired check below.
  if (await probeTags(devUrl)) {
    result.hadTags = true;
    return result;
  }
  const wired = isPluginWired(projectRoot, framework);
  if (framework === "vite" && wired) {
    // Vite injects in-DOM; the served shell legitimately has no tags.
    result.hadTags = true;
    return result;
  }

  // 2. Not ready. Auto-configure what we can.
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY);
  const confirm =
    opts.confirm ?? (interactive ? defaultConfirm : async () => false);
  const mayEdit = async (what: string): Promise<boolean> => {
    if (opts.yes) return true;
    if (!interactive) return false; // never edit non-interactively
    return confirm(what);
  };

  console.log(
    chalk.yellow("\n  ⚠ No source tags on"),
    chalk.cyan(devUrl) + chalk.yellow(" — elements won't be editable yet.")
  );

  if (framework === "unknown") {
    printManualSetup(framework);
    return result;
  }

  if (!wired) {
    if (
      await mayEdit(
        `  Wire the @layoutdesign/context dev plugin into your ${framework}.config?`
      )
    ) {
      // Dependency first — a wired config that imports a missing package
      // breaks `next dev` outright.
      ensureDependency(projectRoot);
      installPlugin(projectRoot, framework);
      ensureLayoutLiveDir(projectRoot);
      result.wiredPlugin = true;
      result.needsRestart = true;
    } else {
      printManualSetup(framework);
      return result;
    }
  }

  if (framework === "next") {
    const fix = fixTurbopackDevScript(projectRoot);
    if (fix.changed) {
      // package.json edit is low-risk (a one-flag removal); apply it but say so.
      console.log(
        chalk.green("  ✓"),
        `package.json: ${chalk.dim(`dev → "${fix.after}"`)} ${chalk.dim(
          "(Turbopack bypasses source tagging)"
        )}`
      );
      result.fixedTurbopack = true;
      result.needsRestart = true;
    }
  }

  if (result.needsRestart) {
    console.log(
      chalk.bold("\n  ↻ Restart your dev server"),
      chalk.dim("(npm run dev)"),
      chalk.bold("— the canvas becomes editable on reload.\n")
    );
  } else {
    // Wired + webpack but still no tags: surface the manual path as a backstop.
    printManualSetup(framework);
  }

  return result;
}
