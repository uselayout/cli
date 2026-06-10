/**
 * Shared fallback reader for Layout Live's on-disk logs
 * (`.layout/live/recent-edits.json`, `.layout/live/requests.json`).
 *
 * Live writes `{ version: 1, edits|requests: [...] }` (legacy files may be a
 * bare array). Items are validated per-entry against the canonical schemas in
 * `src/live/schema.ts` — invalid entries are skipped rather than failing the
 * whole read, and a future `version > 1` produces a warning instead of a
 * silent empty result.
 */
import { promises as fs } from "node:fs";
import type { z } from "zod";

export interface LiveLogRead<T> {
  items: T[];
  warnings: string[];
}

/** Read + validate a Live log file. Missing/corrupt file → empty, no warnings. */
export async function readLiveLog<S extends z.ZodType>(
  filePath: string,
  itemsKey: "edits" | "requests",
  itemSchema: S,
  fileLabel: string
): Promise<LiveLogRead<z.output<S>>> {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return { items: [], warnings };
  }

  let rawItems: unknown[] = [];
  if (Array.isArray(parsed)) {
    // Legacy bare-array format.
    rawItems = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.version === "number" && obj.version > 1) {
      warnings.push(
        `${fileLabel} is schema version ${obj.version}; this CLI understands ` +
          "version 1 — upgrade @layoutdesign/context. Entries are read " +
          "best-effort and unrecognised ones are skipped."
      );
    }
    if (Array.isArray(obj[itemsKey])) {
      rawItems = obj[itemsKey] as unknown[];
    }
  }

  // Per-item validation: skip invalid entries rather than failing the read.
  const items: Array<z.output<S>> = [];
  for (const raw of rawItems) {
    const res = itemSchema.safeParse(raw);
    if (res.success) items.push(res.data);
  }
  return { items, warnings };
}
