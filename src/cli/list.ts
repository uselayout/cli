import chalk from "chalk";
import { listBundledKits } from "../kit/loader.js";
import { getRegistry } from "../kit/registry.js";

export async function listCommand(): Promise<void> {
  const bundled = new Set(listBundledKits());
  const registry = getRegistry();

  console.log();
  console.log(chalk.bold("Available Design Kits"));
  console.log();

  // Calculate column widths for alignment
  const nameWidth = Math.max(...registry.map((e) => e.name.length), 8) + 2;
  const displayWidth =
    Math.max(...registry.map((e) => e.displayName.length), 8) + 2;

  for (const entry of registry) {
    const name = entry.name.padEnd(nameWidth);
    const displayName = entry.displayName.padEnd(displayWidth);
    const description = entry.description;

    const isBundled = bundled.has(entry.name);

    let tag: string;
    if (entry.tier === "free") {
      tag = isBundled
        ? chalk.green("[free]")
        : chalk.green("[free]") + chalk.dim(" (registry)");
    } else {
      tag = chalk.yellow(entry.price ?? "paid");
    }

    console.log(
      `  ${chalk.cyan(name)} ${chalk.white(displayName)} ${chalk.dim(description)}  ${tag}`
    );
  }

  console.log();
  console.log(chalk.dim("Commands:"));
  console.log(
    `  ${chalk.cyan("layout-context init --kit <name>")}  Scaffold with a kit`
  );
  console.log(
    `  ${chalk.cyan("layout-context use <name>")}          Switch to a different kit`
  );
  console.log(
    `  ${chalk.cyan("layout-context import <zip>")}        Import a Layout export`
  );
  console.log();
}
