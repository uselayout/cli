/**
 * `layout-context add <name...>` — install Layout UI components from the registry.
 *
 * Our answer to `npx shadcn add`: pulls shadcn-format registry items from
 * https://ui.staging.layout.design/r (or LAYOUT_REGISTRY / --registry), resolves
 * their registry + npm dependencies, writes the component files into the project,
 * generates lib/utils.ts for the `utils` dependency, installs missing npm
 * packages with the project's package manager, and merges theme cssVars into the
 * project's global stylesheet.
 *
 * All pure logic (resolution, import rewriting, css merge) lives in
 * ../registry/index.ts so it stays unit-testable; this file is the I/O shell.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { detectPackageManager } from "../install/live.js";
import {
  resolveRegistryBase,
  resolveItems,
  rewriteImports,
  destFileName,
  injectBlock,
  UTILS_FILE_CONTENT,
  UTILS_DEPENDENCIES,
  type ItemFetcher,
  type RegistryItem,
  type RegistryRef,
} from "../registry/index.js";

export interface AddOptions {
  registry?: string;
  dir?: string;
  css?: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

export async function addCommand(
  names: string[],
  options: AddOptions
): Promise<void> {
  if (names.length === 0) {
    console.log(chalk.red("Error:"), "specify at least one component, e.g.");
    console.log(`  ${chalk.cyan("layout-context add button")}`);
    return;
  }

  const cwd = process.cwd();
  const registryBase = resolveRegistryBase(options.registry);
  const dry = options.dryRun ?? false;

  console.log(
    chalk.dim(`Registry: ${registryBase}${dry ? "  (dry run)" : ""}`)
  );

  // 1. Resolve the requested items and their registry dependencies.
  const fetchItem = makeItemFetcher(registryBase);
  let resolved;
  try {
    resolved = await resolveItems(names, fetchItem);
  } catch (err) {
    console.log(chalk.red("Error:"), (err as Error).message);
    return;
  }

  if (resolved.items.length === 0) {
    console.log(
      chalk.red("Error:"),
      `Could not resolve ${names.map((n) => chalk.bold(n)).join(", ")} from the registry.`
    );
    return;
  }

  for (const missing of resolved.unresolved) {
    console.log(
      chalk.yellow("⚠"),
      `Registry dependency ${chalk.bold(missing)} not found — skipping.`
    );
  }

  // 2. Work out where component files go and which import aliases to use.
  const componentsDir = resolveComponentsDir(cwd, options.dir);
  const useSrc = componentsDir.includes(`${path.sep}src${path.sep}`) ||
    componentsDir.startsWith(`src${path.sep}`);
  const utilsAlias = "@/lib/utils";
  const componentAlias = "@/components/ui";

  console.log(
    chalk.dim(
      `Components → ${path.relative(cwd, componentsDir) || "."}${path.sep}`
    )
  );
  console.log();

  const written: string[] = [];
  const skipped: string[] = [];
  const npmDeps = new Set<string>();

  // 3. Generate lib/utils.ts if any item depends on `utils`.
  if (resolved.needsUtils) {
    const libDir = path.join(useSrc ? path.join(cwd, "src") : cwd, "lib");
    const utilsPath = path.join(libDir, "utils.ts");
    const rel = path.relative(cwd, utilsPath);
    if (fs.existsSync(utilsPath) && !options.overwrite) {
      skipped.push(rel);
    } else {
      if (!dry) {
        fs.mkdirSync(libDir, { recursive: true });
        fs.writeFileSync(utilsPath, UTILS_FILE_CONTENT);
      }
      written.push(rel);
    }
    for (const d of UTILS_DEPENDENCIES) npmDeps.add(d);
  }

  // 4. Write each item's files and collect npm dependencies + cssVars.
  const themeVars: {
    theme: Record<string, string>;
    light: Record<string, string>;
    dark: Record<string, string>;
  } = { theme: {}, light: {}, dark: {} };

  for (const item of resolved.items) {
    for (const d of item.dependencies ?? []) npmDeps.add(d);
    for (const d of item.devDependencies ?? []) npmDeps.add(d);

    if (item.cssVars) {
      Object.assign(themeVars.theme, item.cssVars.theme ?? {});
      Object.assign(themeVars.light, item.cssVars.light ?? {});
      Object.assign(themeVars.dark, item.cssVars.dark ?? {});
    }

    for (const file of item.files ?? []) {
      if (file.content === undefined) continue;
      const dest = path.join(componentsDir, destFileName(file));
      const rel = path.relative(cwd, dest);
      if (fs.existsSync(dest) && !options.overwrite) {
        skipped.push(rel);
        continue;
      }
      const rewritten = rewriteImports(file.content, {
        componentAlias,
        utilsAlias,
      });
      if (!dry) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, rewritten);
      }
      written.push(rel);
    }
  }

  // 5. Per-item status output.
  for (const item of resolved.items) {
    const label = item.title ?? item.name;
    console.log(`${chalk.green("✓")} ${chalk.bold(item.name)} ${chalk.dim(label)}`);
  }
  console.log();

  if (written.length > 0) {
    console.log(chalk.bold(dry ? "Would write:" : "Wrote:"));
    for (const f of written) console.log(`  ${chalk.green("+")} ${f}`);
    console.log();
  }

  if (skipped.length > 0) {
    console.log(
      chalk.yellow("Skipped (already exist — pass --overwrite to replace):")
    );
    for (const f of skipped) console.log(`  ${chalk.yellow("•")} ${f}`);
    console.log();
  }

  // 6. npm dependency install (diff against package.json).
  await ensureNpmDeps(cwd, [...npmDeps], dry);

  // 7. Inject cssVars into the project's global stylesheet.
  injectCssVars(cwd, options.css, themeVars, useSrc, dry);

  // 8. Final import hint.
  const first = resolved.items.find((i) => (i.type ?? "").startsWith("registry:ui"));
  const firstFile = first?.files?.[0];
  if (first && firstFile) {
    const name = destFileName(firstFile).replace(/\.[^.]+$/, "");
    const exportName = pascalCase(first.name);
    console.log(
      chalk.dim("Import:"),
      `import { ${exportName} } from "${componentAlias}/${name}"`
    );
  }
}

/** Build a fetcher that pulls registry items by name or full URL. */
function makeItemFetcher(registryBase: string): ItemFetcher {
  return async (ref: RegistryRef): Promise<RegistryItem | null> => {
    const url =
      ref.kind === "url"
        ? ref.value
        : `${registryBase}/${encodeURIComponent(ref.value)}.json`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (err) {
      throw new Error(`Could not reach ${url} (${(err as Error).message}).`);
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Registry returned ${res.status} ${res.statusText} for ${url}.`);
    }
    return (await res.json()) as RegistryItem;
  };
}

/**
 * Resolve the target components directory.
 *   --dir <path>        -> used verbatim (relative to cwd)
 *   else auto-detect    -> src/components/ui if a src/ dir exists and there is
 *                          no top-level app/, otherwise components/ui
 */
export function resolveComponentsDir(cwd: string, dirFlag?: string): string {
  if (dirFlag) return path.resolve(cwd, dirFlag);
  const hasSrc = fs.existsSync(path.join(cwd, "src"));
  const hasTopApp = fs.existsSync(path.join(cwd, "app"));
  const prefix = hasSrc && !hasTopApp ? path.join(cwd, "src") : cwd;
  return path.join(prefix, "components", "ui");
}

/** Install any npm dependencies not already declared in the project. */
async function ensureNpmDeps(
  cwd: string,
  deps: string[],
  dry: boolean
): Promise<void> {
  if (deps.length === 0) return;

  const declared = readDeclaredDeps(cwd);
  // Compare on the bare package name (strip any version range in the dep spec).
  const missing = deps.filter((d) => !declared.has(barePackageName(d)));

  if (missing.length === 0) {
    console.log(chalk.dim("Dependencies already satisfied."));
    console.log();
    return;
  }

  const pm = detectPackageManager(cwd);
  const args =
    pm === "npm" ? ["install", ...missing] : ["add", ...missing];

  if (dry) {
    console.log(chalk.bold("Would install dependencies:"));
    console.log(`  ${chalk.cyan(`${pm} ${args.join(" ")}`)}`);
    console.log();
    return;
  }

  console.log(chalk.dim(`Installing ${missing.length} package(s) with ${pm}…`));
  try {
    execFileSync(pm, args, { cwd, stdio: "inherit" });
    console.log(chalk.green("✓"), "Dependencies installed.");
  } catch {
    console.log(
      chalk.yellow("⚠"),
      `Couldn't install automatically. Run: ${chalk.cyan(`${pm} ${args.join(" ")}`)}`
    );
  }
  console.log();
}

/** All declared deps (dependencies + devDependencies) as bare names. */
function readDeclaredDeps(cwd: string): Set<string> {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return new Set(
      Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    );
  } catch {
    return new Set();
  }
}

/** "@base-ui/react@^1" -> "@base-ui/react"; "clsx@2" -> "clsx". */
function barePackageName(dep: string): string {
  if (dep.startsWith("@")) {
    const at = dep.indexOf("@", 1);
    return at === -1 ? dep : dep.slice(0, at);
  }
  const at = dep.indexOf("@");
  return at === -1 ? dep : dep.slice(0, at);
}

/** Locate the project global stylesheet and merge cssVars into it. */
function injectCssVars(
  cwd: string,
  cssFlag: string | undefined,
  themeVars: {
    theme: Record<string, string>;
    light: Record<string, string>;
    dark: Record<string, string>;
  },
  useSrc: boolean,
  dry: boolean
): void {
  const hasAny =
    Object.keys(themeVars.theme).length +
      Object.keys(themeVars.light).length +
      Object.keys(themeVars.dark).length >
    0;
  if (!hasAny) return;

  const cssPath = resolveCssFile(cwd, cssFlag, useSrc);
  if (!cssPath) {
    console.log(
      chalk.yellow("⚠"),
      "Couldn't find a global stylesheet to inject theme variables. Add them manually or pass --css <file>."
    );
    console.log();
    return;
  }

  let css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
  css = injectBlock(css, ":root", themeVars.light);
  css = injectBlock(css, ".dark", themeVars.dark);
  css = injectBlock(css, "@theme inline", themeVars.theme);

  const rel = path.relative(cwd, cssPath);
  if (!dry) fs.writeFileSync(cssPath, css);

  const counts = [
    Object.keys(themeVars.light).length
      ? `${Object.keys(themeVars.light).length} :root`
      : "",
    Object.keys(themeVars.dark).length
      ? `${Object.keys(themeVars.dark).length} .dark`
      : "",
    Object.keys(themeVars.theme).length
      ? `${Object.keys(themeVars.theme).length} @theme`
      : "",
  ].filter(Boolean);

  console.log(
    dry ? chalk.bold("Would inject theme vars:") : chalk.bold("Injected theme vars:"),
    chalk.dim(`${counts.join(", ")} → ${rel}`)
  );
  console.log();
}

/** Find the project global CSS: --css flag, else search common locations. */
export function resolveCssFile(
  cwd: string,
  cssFlag: string | undefined,
  useSrc: boolean
): string | null {
  if (cssFlag) return path.resolve(cwd, cssFlag);
  const candidates = [
    "app/globals.css",
    "src/app/globals.css",
    "src/index.css",
    "src/styles/globals.css",
    "styles/globals.css",
    "src/App.css",
  ];
  for (const c of candidates) {
    const p = path.join(cwd, c);
    if (fs.existsSync(p)) return p;
  }
  // Nothing found — fall back to the conventional Vite location so a create step
  // targets a sensible path only when we actually know src/ is in use.
  return useSrc ? path.join(cwd, "src", "index.css") : null;
}

/** "alert-dialog" -> "AlertDialog". Used only for the closing import hint. */
function pascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}
