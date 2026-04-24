// Token-level diff engine for two layout kits. Mirrors the shape of the
// extraction-diff UI in Studio so outputs are recognisable to anyone who
// has used re-extract.

import type { Kit } from "../kit/types.js";

export interface TokenChange {
  name: string;
  before?: string;
  after?: string;
}

export interface KitDiff {
  tokens: {
    added: TokenChange[];
    removed: TokenChange[];
    modified: TokenChange[];
  };
  sections: {
    added: string[];
    removed: string[];
  };
  summary: {
    totalChanges: number;
    breakingChanges: number;
  };
}

function parseCssTokens(css: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!css) return map;
  for (const match of css.matchAll(/^\s*(--[a-zA-Z0-9_-]+)\s*:\s*([^;\n]+);/gm)) {
    const name = match[1];
    const value = match[2];
    if (name && value) map.set(name, value.trim());
  }
  return map;
}

function parseSections(layoutMd: string): Set<string> {
  const out = new Set<string>();
  for (const match of layoutMd.matchAll(/^##\s+(.+)$/gm)) {
    if (match[1]) out.add(match[1].trim());
  }
  return out;
}

export function diffKits(base: Kit, head: Kit): KitDiff {
  const baseTokens = parseCssTokens(base.tokensCss);
  const headTokens = parseCssTokens(head.tokensCss);

  const added: TokenChange[] = [];
  const removed: TokenChange[] = [];
  const modified: TokenChange[] = [];

  for (const [name, value] of headTokens) {
    if (!baseTokens.has(name)) {
      added.push({ name, after: value });
    } else if (baseTokens.get(name) !== value) {
      modified.push({ name, before: baseTokens.get(name), after: value });
    }
  }
  for (const [name, value] of baseTokens) {
    if (!headTokens.has(name)) removed.push({ name, before: value });
  }

  const baseSections = parseSections(base.layoutMd);
  const headSections = parseSections(head.layoutMd);
  const sectionsAdded: string[] = [];
  const sectionsRemoved: string[] = [];
  for (const s of headSections) if (!baseSections.has(s)) sectionsAdded.push(s);
  for (const s of baseSections) if (!headSections.has(s)) sectionsRemoved.push(s);

  const totalChanges = added.length + removed.length + modified.length + sectionsAdded.length + sectionsRemoved.length;
  // Breaking: removed tokens + removed sections (references in downstream code
  // may now fail).
  const breakingChanges = removed.length + sectionsRemoved.length;

  return {
    tokens: { added, removed, modified },
    sections: { added: sectionsAdded, removed: sectionsRemoved },
    summary: { totalChanges, breakingChanges },
  };
}
