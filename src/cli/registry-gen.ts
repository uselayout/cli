/**
 * `npx @layoutdesign/context registry-gen [kit...]`
 *
 * Generates shadcn-compatible registry item JSON for one or more kits, so any
 * kit is installable with the stock shadcn CLI:
 *
 *   npx shadcn@latest add <raw URL to registry/<kit>/registry.json>
 *
 * With no arguments it regenerates the committed registry/ outputs for every
 * bundled kit. A kit reference can be a bundled kit name, a project directory
 * containing .layout/, or a kit directory with layout.md at its root.
 */
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { loadKit, listBundledKits } from "../kit/loader.js";
import { stageKitReference } from "../kit/stage.js";
import { renderKitRegistryItem } from "../export/registry.js";

export interface RegistryGenOptions {
  /** Output directory; registry/<kit-name>/registry.json is written under it. */
  out?: string;
}

export async function registryGenCommand(
  kitRefs: string[],
  options: RegistryGenOptions
): Promise<void> {
  const refs = kitRefs.length > 0 ? kitRefs : listBundledKits();
  if (refs.length === 0) {
    console.log(chalk.red("Error:"), "No kits specified and no bundled kits found.");
    process.exitCode = 1;
    return;
  }

  const outBase = path.resolve(options.out ?? "registry");
  let failures = 0;

  for (const ref of refs) {
    const staged = stageKitReference(ref);
    try {
      const kit = loadKit(staged.path);
      if (!kit) {
        console.log(
          chalk.red("  ✗"),
          `${ref}: not a kit (no layout.md found via bundled name, .layout/ dir, or kit dir)`
        );
        failures++;
        continue;
      }
      const dest = path.join(outBase, kit.manifest.name, "registry.json");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, renderKitRegistryItem(kit));
      console.log(
        chalk.green("  ✓"),
        `${kit.manifest.name} → ${path.relative(process.cwd(), dest)}`
      );
    } finally {
      staged.cleanup();
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }
  console.log();
  console.log(
    chalk.dim("  Install with the stock shadcn CLI once the JSON is publicly served:")
  );
  console.log(chalk.cyan("    npx shadcn@latest add <raw URL to registry.json>"));
}
