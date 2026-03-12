import { z } from "zod";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { LAYOUT_DIR } from "../../kit/types.js";

export const name = "get-screenshots";

export const description =
  "Get design system reference screenshots captured during website extraction. " +
  "Returns full-page and/or viewport screenshots as images that can be used for " +
  "visual comparison when building UI components.";

export const inputSchema = {
  type: z
    .enum(["full-page", "viewport", "all"])
    .optional()
    .default("all")
    .describe("Which screenshot to return: full-page, viewport, or all (default)"),
};

const SCREENSHOTS_DIR = "screenshots";

export function handler() {
  return async ({ type = "all" }: { type?: "full-page" | "viewport" | "all" }) => {
    const dir = resolve(process.cwd(), LAYOUT_DIR, SCREENSHOTS_DIR);

    if (!existsSync(dir)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No screenshots found. Screenshots are captured during website extraction in the Studio and included in exported bundles.",
          },
        ],
      };
    }

    const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
    if (files.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Screenshots directory exists but contains no PNG files.",
          },
        ],
      };
    }

    const wantedFiles = files.filter((f) => {
      if (type === "all") return true;
      if (type === "full-page") return f.includes("full-page");
      if (type === "viewport") return f.includes("viewport");
      return false;
    });

    if (wantedFiles.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No ${type} screenshot found. Available: ${files.join(", ")}`,
          },
        ],
      };
    }

    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

    for (const file of wantedFiles) {
      const filePath = join(dir, file);
      const buffer = readFileSync(filePath);
      const base64 = buffer.toString("base64");

      content.push({
        type: "text" as const,
        text: `Screenshot: ${file}`,
      });
      content.push({
        type: "image" as const,
        data: base64,
        mimeType: "image/png",
      });
    }

    return { content };
  };
}
