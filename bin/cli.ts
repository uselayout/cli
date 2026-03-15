#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import { initCommand } from "../src/cli/init.js";
import { serveCommand } from "../src/cli/serve.js";
import { importCommand } from "../src/cli/import-zip.js";
import { useCommand } from "../src/cli/use.js";
import { listCommand } from "../src/cli/list.js";
import { installCommand } from "../src/cli/install.js";
import { doctorCommand } from "../src/cli/doctor.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const program = new Command();

program
  .name("layout-context")
  .description(
    "Design system context for AI coding agents — MCP server + CLI"
  )
  .version(pkg.version);

program
  .command("init")
  .description("Scaffold a .layout/ directory in the current project")
  .option("--kit <name>", "Start with a specific design kit")
  .action(async (options: { kit?: string }) => {
    await initCommand(options);
  });

program
  .command("serve")
  .description("Start the MCP server (stdio transport)")
  .action(async () => {
    await serveCommand();
  });

program
  .command("import <zip-path>")
  .description("Import a Layout export ZIP into .layout/")
  .action(async (zipPath: string) => {
    await importCommand(zipPath);
  });

program
  .command("use <kit-name>")
  .description("Install a design kit from the registry")
  .action(async (kitName: string) => {
    await useCommand(kitName);
  });

program
  .command("list")
  .description("Show all available design kits")
  .action(async () => {
    await listCommand();
  });

program
  .command("install")
  .description("Auto-configure MCP servers (Layout + Figma + Playwright) for Claude Code, Cursor, or Windsurf")
  .option("--target <tool>", "Specific tool: claude, cursor, or windsurf")
  .option("--global", "Install globally (available in all projects, Claude Code only)")
  .option("--skip-figma", "Skip Figma and Playwright MCP setup")
  .action(async (options: { target?: string; global?: boolean; skipFigma?: boolean }) => {
    await installCommand(options);
  });

program
  .command("doctor")
  .description("Check Node.js version, Claude CLI, and MCP dependencies")
  .option("--fix", "Auto-install missing MCP servers")
  .action(async (options: { fix?: boolean }) => {
    await doctorCommand(options);
  });

program.parse();
