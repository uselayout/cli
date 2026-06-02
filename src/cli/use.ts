import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { getBundledKitPath, listBundledKits } from "../kit/loader.js";
import { findKitInRegistry, getRegistry } from "../kit/registry.js";
import { fetchKitFromGallery } from "./fetch-kit.js";
import { LAYOUT_DIR } from "../kit/types.js";

export async function useCommand(kitName: string): Promise<void> {
  const targetDir = path.join(process.cwd(), LAYOUT_DIR);

  // 1. Bundled kits ship with the package — copy directly.
  const bundledPath = getBundledKitPath(kitName);
  if (bundledPath) {
    fs.cpSync(bundledPath, targetDir, { recursive: true });
    printInstalled(kitName);
    return;
  }

  // 2. Premium kits in the static registry require purchase.
  const registryEntry = findKitInRegistry(kitName);
  if (registryEntry?.tier === "pro") {
    console.log(
      chalk.yellow("Pro kit:"),
      `${chalk.bold(registryEntry.displayName)} is a premium kit (${chalk.yellow(registryEntry.price ?? "paid")}).`
    );
    console.log();
    console.log(
      `  Purchase at ${chalk.cyan("https://layout.design/kits/" + kitName)}`
    );
    console.log(
      `  Then import with: ${chalk.cyan(`layout-context import <path-to-zip>`)}`
    );
    return;
  }

  // 3. Anything else — try the public gallery at layout.design.
  console.log(chalk.dim(`Fetching ${chalk.bold(kitName)} from the gallery…`));
  const result = await fetchKitFromGallery(kitName);

  if (result.status === "installed") {
    printInstalled(kitName, result.imported);
    return;
  }

  if (result.status === "error") {
    console.log(chalk.red("Error:"), result.message);
    return;
  }

  // not-found — show what is available
  console.log(chalk.red("Error:"), `Kit "${kitName}" not found in the gallery.`);
  console.log();
  printAvailableKits();
}

function printInstalled(kitName: string, imported?: string[]): void {
  console.log(
    chalk.green("✓"),
    `Installed the ${chalk.bold(kitName)} kit into .layout/`
  );
  if (imported && imported.length > 0) {
    for (const file of imported) {
      console.log(`  ${chalk.dim("•")} ${file}`);
    }
  }
  console.log();
  console.log(
    `Run ${chalk.cyan("layout-context install")} to connect the MCP server.`
  );
}

function printAvailableKits(): void {
  const bundled = listBundledKits();
  const registry = getRegistry();

  if (bundled.length > 0) {
    console.log(chalk.dim("Bundled (free):"));
    for (const name of bundled) {
      console.log(`  ${chalk.green("•")} ${name}`);
    }
    console.log();
  }

  const proKits = registry.filter((e) => e.tier === "pro");
  if (proKits.length > 0) {
    console.log(chalk.dim("Premium:"));
    for (const kit of proKits) {
      console.log(
        `  ${chalk.yellow("•")} ${kit.name} — ${kit.displayName} (${chalk.yellow(kit.price ?? "paid")})`
      );
    }
    console.log();
  }

  console.log(
    `Browse all community kits at ${chalk.cyan("https://layout.design/gallery")}.`
  );
  console.log(
    `Run ${chalk.cyan("layout-context list")} for bundled and premium kits.`
  );
}
