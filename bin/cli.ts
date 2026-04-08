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
import { serveLocalCommand } from "../src/cli/serve-local.js";
import { scanCommand } from "../src/cli/scan.js";

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
  .description("Auto-configure MCP servers (Layout + Figma + Playwright) for Claude Code, Cursor, Windsurf, VS Code, Codex, or Gemini")
  .option("--target <tool>", "Specific tool: claude, cursor, windsurf, vscode, codex, or gemini")
  .option("--global", "Install globally (available in all projects, Claude Code only)")
  .option("--skip-figma", "Skip Figma and Playwright MCP setup")
  .action(async (options: { target?: string; global?: boolean; skipFigma?: boolean }) => {
    await installCommand(options);
  });

program
  .command("serve-local <path>")
  .description("Serve a local file or directory over HTTP for use with url-to-figma (file:// URLs are not supported by Figma)")
  .option("--port <n>", "Port to use (default: auto-detect from 8765)")
  .option("--quiet", "Print only the URL (useful for scripting)")
  .action(async (targetPath: string, options: { port?: string; quiet?: boolean }) => {
    await serveLocalCommand(targetPath, {
      port: options.port ? parseInt(options.port, 10) : undefined,
      quiet: options.quiet,
    });
  });

program
  .command("doctor")
  .description("Check Node.js version, AI tool CLIs, and MCP dependencies")
  .option("--fix", "Auto-install missing MCP servers")
  .option("--verbose", "Show detailed diagnostic output including raw MCP server data")
  .action(async (options: { fix?: boolean; verbose?: boolean }) => {
    await doctorCommand(options);
  });

program
  .command("scan [path]")
  .description("Scan the codebase for React components and Storybook stories")
  .option("--sync", "Upload results to your Layout project")
  .option("--project <id>", "Layout project ID (auto-detected from .layout/ if not specified)")
  .option("--type <type>", "Scan type: storybook, codebase, or both (default: both)")
  .action(async (targetPath?: string, options?: { sync?: boolean; project?: string; type?: string }) => {
    await scanCommand(targetPath, options);
  });

program.parse();
