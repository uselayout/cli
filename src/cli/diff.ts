import { loadKit } from "../kit/loader.js";
import { stageKitReference } from "../kit/stage.js";
import { diffKits, type KitDiff } from "../lint/diff.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export async function diffCommand(
  base: string,
  head: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const baseStaged = stageKitReference(base);
  const headStaged = stageKitReference(head);
  const cleanup = () => {
    baseStaged.cleanup();
    headStaged.cleanup();
  };

  const baseKit = loadKit(baseStaged.path);
  const headKit = loadKit(headStaged.path);
  if (!baseKit || !headKit) {
    cleanup();
    process.stderr.write(`${RED}Failed to load one or both kits (checked path, .layout/ subfolder, and bundled-kit name).${RESET}\n`);
    process.exit(1);
  }

  const diff = diffKits(baseKit, headKit);
  cleanup();

  if (options.json) {
    process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
    process.exit(diff.summary.breakingChanges > 0 ? 1 : 0);
  }

  printHuman(diff, base, head);
  process.exit(diff.summary.breakingChanges > 0 ? 1 : 0);
}

function printHuman(diff: KitDiff, baseLabel: string, headLabel: string): void {
  process.stdout.write(`${BOLD}layout diff${RESET}  ${DIM}${baseLabel} → ${headLabel}${RESET}\n`);

  if (diff.summary.totalChanges === 0) {
    process.stdout.write(`\n${GREEN}No changes.${RESET}\n`);
    return;
  }

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    process.stdout.write(`\n${BOLD}${title}${RESET}\n`);
    for (const row of rows) process.stdout.write(`  ${row}\n`);
  };

  section(
    `Tokens added (${diff.tokens.added.length})`,
    diff.tokens.added.map((t) => `${GREEN}+${RESET} ${t.name}: ${DIM}${t.after}${RESET}`),
  );
  section(
    `Tokens removed (${diff.tokens.removed.length})`,
    diff.tokens.removed.map((t) => `${RED}-${RESET} ${t.name}: ${DIM}${t.before}${RESET}`),
  );
  section(
    `Tokens modified (${diff.tokens.modified.length})`,
    diff.tokens.modified.map((t) => `${YELLOW}~${RESET} ${t.name}: ${DIM}${t.before ?? "∅"} → ${t.after ?? "∅"}${RESET}`),
  );
  section(
    `Sections added (${diff.sections.added.length})`,
    diff.sections.added.map((s) => `${GREEN}+${RESET} ${s}`),
  );
  section(
    `Sections removed (${diff.sections.removed.length})`,
    diff.sections.removed.map((s) => `${RED}-${RESET} ${s}`),
  );

  process.stdout.write(
    `\n${BOLD}${diff.summary.totalChanges} changes${RESET}  ${diff.summary.breakingChanges} breaking\n`,
  );
}
