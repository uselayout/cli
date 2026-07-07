/**
 * Delimited managed blocks in agent context files (CLAUDE.md, AGENTS.md,
 * .cursorrules). A managed block is bounded by HTML-comment markers so it can
 * be refreshed in place on re-runs without touching the user's own content.
 *
 * Shared by `install --live` (the layout-live block) and `export`
 * (the design-system block).
 */
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";

export interface ManagedBlock {
  /** Opening marker, e.g. `<!-- BEGIN layout-live (managed) -->`. */
  begin: string;
  /** Closing marker. */
  end: string;
  /** Full block content INCLUDING the begin/end markers. */
  content: string;
  /** Short name used in log lines, e.g. "layout-live". */
  name: string;
}

export interface ManagedBlockResult {
  changed: boolean;
  /** True when the target file did not exist and was created. */
  created: boolean;
}

/** Wrap a body in begin/end markers to form a managed block. */
export function makeManagedBlock(
  name: string,
  body: string
): ManagedBlock {
  const begin = `<!-- BEGIN ${name} (managed) -->`;
  const end = `<!-- END ${name} (managed) -->`;
  return { begin, end, content: `${begin}\n${body}\n${end}`, name };
}

/**
 * Apply a managed block to one agent file, idempotently.
 * - File absent + `createIfMissing` false: no-op.
 * - File absent + `createIfMissing` true: created containing only the block.
 * - Block present: refreshed in place (no-op if already current).
 * - Block absent: appended after the existing content.
 */
export function applyManagedBlock(
  file: string,
  block: ManagedBlock,
  options: { label: string; createIfMissing: boolean; quiet?: boolean }
): ManagedBlockResult {
  const { label, createIfMissing, quiet } = options;
  const log = quiet
    ? () => {}
    : (...args: unknown[]) => console.log(...args);

  const exists = fs.existsSync(file);
  if (!exists && !createIfMissing) return { changed: false, created: false };
  const existing = exists ? fs.readFileSync(file, "utf8") : "";

  if (existing.includes(block.begin)) {
    const before = existing.slice(0, existing.indexOf(block.begin));
    const afterIdx = existing.indexOf(block.end);
    const after =
      afterIdx === -1 ? "" : existing.slice(afterIdx + block.end.length);
    const next = `${before}${block.content}${after}`;
    if (next === existing) {
      log(chalk.dim("  ↳"), `${label}: managed block already current`);
      return { changed: false, created: false };
    }
    fs.writeFileSync(file, next);
    log(chalk.green("  ✓"), `${label}: refreshed ${block.name} block`);
    return { changed: true, created: false };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep =
    existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, `${existing}${sep}${block.content}\n`);
  log(
    chalk.green("  ✓"),
    existing.length === 0
      ? `${label}: created with ${block.name} block`
      : `${label}: appended ${block.name} block`
  );
  return { changed: true, created: !exists };
}
