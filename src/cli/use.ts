import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { getBundledKitPath, listBundledKits } from "../kit/loader.js";
import { findKitInRegistry, getRegistry } from "../kit/registry.js";
import { LAYOUT_DIR } from "../kit/types.js";

export async function useCommand(kitName: string): Promise<void> {
  const targetDir = path.join(process.cwd(), LAYOUT_DIR);

  // Check bundled kits first
  const bundledPath = getBundledKitPath(kitName);

  if (bundledPath) {
    fs.cpSync(bundledPath, targetDir, { recursive: true });
    console.log(
      chalk.green("✓"),
      `Installed the ${chalk.bold(kitName)} kit into .layout/`
    );
    console.log();
    console.log(
      `Run ${chalk.cyan("layout-context serve")} to start the MCP server.`
    );
    return;
  }

  // Check registry
  const registryEntry = findKitInRegistry(kitName);

  if (registryEntry) {
    if (registryEntry.tier === "pro") {
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

    // Free registry kit not bundled — packaging issue
    console.log(
      chalk.red("Error:"),
      `Kit "${kitName}" is listed as free but not bundled. This may be a packaging issue.`
    );
    return;
  }

  // Not found
  console.log(chalk.red("Error:"), `Kit "${kitName}" not found.`);
  console.log();

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
    `Run ${chalk.cyan("layout-context list")} for full details.`
  );
}
