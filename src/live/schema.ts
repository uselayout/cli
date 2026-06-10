/**
 * Canonical Layout Live data contract — Zod schemas + inferred types.
 *
 * THIS FILE IS THE SOURCE OF TRUTH for the shapes Layout Live (the Electron
 * desktop app) writes to `.layout/live/` (recent-edits.json, requests.json)
 * and serves over its unix-socket protocol. It is vendored BYTE-IDENTICALLY
 * into layout-live at `src/shared/live-schema.ts` — edit it here, then copy
 * it verbatim. Mirrors layout-live `src/main/socket/protocol.ts`.
 *
 * Rules for editing:
 * - Keep it dependency-light and fully self-contained: the ONLY import
 *   allowed is `zod`, so the copy works unchanged in the other repo.
 * - All object schemas use `.passthrough()` so additive future fields never
 *   break older readers. (`.passthrough()` works in both zod v3 and v4 —
 *   do not switch to `z.looseObject`, layout-live resolves zod v3.)
 * - New fields must be optional (additive only). Never remove or rename a
 *   field without a version bump of the on-disk logs.
 */
import { z } from "zod";

/** Box-model snapshot for a request target (mirrors the resolver's `computed`). */
export const RequestBoxSchema = z
  .object({
    padding: z.string().optional(),
    margin: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
  })
  .passthrough();

export type RequestBox = z.infer<typeof RequestBoxSchema>;

/** Where a request is anchored: a source element, a canvas region, or the page. */
export const RequestTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("element"),
      file: z.string(),
      line: z.number(),
      col: z.number(),
      component: z.string().optional(),
      classList: z.string().optional(),
      box: RequestBoxSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("region"),
      rect: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        })
        .passthrough(),
      nearest: z
        .object({
          file: z.string(),
          line: z.number(),
          col: z.number(),
          component: z.string().optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
  z.object({ kind: z.literal("general") }).passthrough(),
]);

export type RequestTarget = z.infer<typeof RequestTargetSchema>;

/**
 * A single visual edit made by the user in Live. All 8 kinds:
 * class/token/inline-style/text are style+content edits; attribute,
 * element-swap, import and asset are media edits (img src/alt, icon swap,
 * the import line accompanying an icon swap, or an asset import).
 */
export const VisualEditSchema = z
  .object({
    id: z.string(),
    timestamp: z.string(), // ISO 8601
    file: z.string(),
    line: z.number(),
    col: z.number(),
    component: z.string().optional(),
    property: z.string(), // 'padding', 'bg-color', etc.
    kind: z.enum([
      "class",
      "token",
      "inline-style",
      "text",
      "attribute",
      "element-swap",
      "import",
      "asset",
    ]),
    before: z.string(),
    after: z.string(),
    /** Responsive variant this edit targeted ("md:" etc.); omitted/"" = base. */
    variant: z.string().optional(),
    /** Internal: structured pre-edit value used by Live's per-edit revert. */
    beforeValue: z.unknown().optional(),
  })
  .passthrough();

export type VisualEdit = z.infer<typeof VisualEditSchema>;

/**
 * A natural-language change the user wants the AI to make, pinned to a
 * selected element (or a region / general page-level ask). Agent-agnostic:
 * Live never calls an AI itself.
 */
export const LiveRequestSchema = z
  .object({
    id: z.string(),
    timestamp: z.string(), // ISO 8601
    message: z.string(), // the user's natural-language ask
    target: RequestTargetSchema,
    status: z.enum(["pending", "done"]), // "done" = dismissed without deleting
    /** Status transitions, oldest first. Additive (Live ≥ requests v2 UI). */
    history: z
      .array(
        z
          .object({
            status: z.enum(["pending", "done"]),
            at: z.string(), // ISO 8601
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type LiveRequest = z.infer<typeof LiveRequestSchema>;
