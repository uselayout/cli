/**
 * Test harness entry point for the `check` command. Spawned by
 * check-command.test.ts with `node --import tsx` so the tests can observe
 * real process exit codes and stdout/stderr without building dist/ first
 * (bin/cli.ts requires the dist layout for its package.json lookup).
 *
 * Usage: node --import tsx test/_run-check.ts <project-root> [flags] [paths...]
 */
import { checkCommand, type CheckOptions } from "../src/cli/check.js";

const [root, ...rest] = process.argv.slice(2);
const paths: string[] = [];
const options: CheckOptions = { path: root };

for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]!;
  if (arg === "--ci") options.ci = true;
  else if (arg === "--warnings-as-errors") options.warningsAsErrors = true;
  else if (arg === "--changed") options.changed = true;
  else if (arg === "--format") options.format = rest[++i];
  else if (arg === "--base") options.base = rest[++i];
  else if (arg === "--max-warnings") options.maxWarnings = Number(rest[++i]);
  else if (arg === "--exclude") {
    options.exclude = [...(options.exclude ?? []), rest[++i]!];
  } else paths.push(arg);
}

await checkCommand(paths, options);
