import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import chalk from "chalk";
import { scanCodebase, scanStorybook } from "../integrations/codebase-scan.js";
import type { ScanResult } from "../integrations/codebase-scan.js";
import { LAYOUT_DIR } from "../kit/types.js";

interface ScanOptions {
  sync?: boolean;
  project?: string;
  type?: string;
}

/**
 * Read org and project IDs from the .layout/kit.json manifest.
 * The layoutUrl field looks like: https://layout.design/<org>/<project>/studio
 * or the manifest may have explicit orgId/projectId fields.
 */
function readProjectContext(
  rootPath: string
): { orgId?: string; projectId?: string } {
  const manifestPath = resolve(rootPath, LAYOUT_DIR, "kit.json");
  if (!existsSync(manifestPath)) return {};

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    // Check explicit fields first
    if (manifest.orgId && manifest.projectId) {
      return { orgId: manifest.orgId, projectId: manifest.projectId };
    }

    // Try to parse from layoutUrl
    if (manifest.layoutUrl) {
      const url = new URL(manifest.layoutUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      // Expected: /<org>/<project>/studio or /<org>/<project>
      if (parts.length >= 2) {
        return { orgId: parts[0], projectId: parts[1] };
      }
    }
  } catch {
    // Ignore parse errors
  }

  return {};
}

function formatScanResult(result: ScanResult): void {
  const withStories = result.components.filter((c) => c.storybook);

  console.log();
  console.log(
    chalk.bold(`Scan complete`),
    chalk.dim(`(${result.durationMs}ms)`)
  );
  console.log();

  console.log(
    `  ${chalk.green(String(result.components.length))} components found`,
    result.storybookStories.length > 0
      ? chalk.dim(`(${withStories.length} with Storybook stories)`)
      : ""
  );

  console.log(
    `  ${chalk.green(String(result.storybookStories.length))} Storybook stories`
  );

  console.log(
    `  ${chalk.dim(String(result.filesScanned))} files scanned`
  );

  if (result.unmatchedStories.length > 0) {
    console.log(
      `  ${chalk.yellow(String(result.unmatchedStories.length))} stories without matching components`
    );
  }

  // Show top components
  if (result.components.length > 0) {
    console.log();
    console.log(chalk.bold("Components:"));
    const display = result.components.slice(0, 20);
    for (const comp of display) {
      const propsCount = comp.props.length;
      const storyIcon = comp.storybook ? chalk.blue(" [stories]") : "";
      const refIcon = comp.usesForwardRef ? chalk.dim(" (forwardRef)") : "";
      const propsLabel = propsCount > 0 ? chalk.dim(` ${propsCount} props`) : "";

      console.log(
        `  ${chalk.cyan(comp.name)}${propsLabel}${refIcon}${storyIcon}`,
        chalk.dim(`— ${comp.filePath}`)
      );
    }
    if (result.components.length > 20) {
      console.log(
        chalk.dim(`  ... and ${result.components.length - 20} more`)
      );
    }
  }
}

export async function scanCommand(
  targetPath?: string,
  options?: ScanOptions
): Promise<void> {
  const rootPath = resolve(targetPath ?? process.cwd());
  const scanType = options?.type ?? "both";

  console.log();
  console.log(
    chalk.bold("Layout Codebase Scanner"),
    chalk.dim(`— ${rootPath}`)
  );

  if (scanType === "storybook") {
    console.log(chalk.dim("  Scanning for Storybook stories only..."));
    const stories = await scanStorybook(rootPath);

    console.log();
    console.log(
      `  ${chalk.green(String(stories.length))} Storybook stories found`
    );

    for (const story of stories.slice(0, 20)) {
      const storyNames = story.stories.map((s) => s.name).join(", ");
      console.log(
        `  ${chalk.cyan(story.componentName)}`,
        chalk.dim(`— ${storyNames}`),
        chalk.dim(`— ${story.filePath}`)
      );
    }
    if (stories.length > 20) {
      console.log(chalk.dim(`  ... and ${stories.length - 20} more`));
    }
    return;
  }

  console.log(chalk.dim("  Scanning..."));

  const result = await scanCodebase(rootPath);
  formatScanResult(result);

  // Sync to Layout web app
  if (options?.sync) {
    await syncResults(rootPath, result, options.project);
  }
}

async function syncResults(
  rootPath: string,
  result: ScanResult,
  projectArg?: string
): Promise<void> {
  console.log();

  const context = readProjectContext(rootPath);
  const orgId = context.orgId;
  const projectId = projectArg ?? context.projectId;

  if (!orgId || !projectId) {
    console.log(
      chalk.red("Error:"),
      "Could not determine project to sync to."
    );
    console.log(
      chalk.dim("  Add orgId and projectId to .layout/kit.json, or use --project <id>")
    );
    return;
  }

  const url = `https://layout.design/api/organizations/${orgId}/projects/${projectId}/scan-results`;

  console.log(
    chalk.dim(`  Syncing to ${url}...`)
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        components: result.components,
        storybookStories: result.storybookStories,
        unmatchedStories: result.unmatchedStories,
        filesScanned: result.filesScanned,
        durationMs: result.durationMs,
      }),
    });

    if (response.ok) {
      console.log(chalk.green("  Synced successfully."));
    } else {
      const text = await response.text();
      console.log(
        chalk.red("  Sync failed:"),
        `${response.status} ${text}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red("  Sync failed:"), msg);
  }
}
