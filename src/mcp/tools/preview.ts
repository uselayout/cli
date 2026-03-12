import { z } from "zod";
import type { Kit } from "../../kit/types.js";
import { PREVIEW_PORT } from "../../kit/types.js";

export const name = "preview";

export const description =
  "Renders a component code snippet in the local live preview canvas. " +
  "The preview server must be running (`npx @layoutdesign/context serve`). " +
  "Use this to visually verify a component matches the design system.";

export const inputSchema = {
  code: z.string().describe("The component code to render in the preview canvas"),
  language: z
    .enum(["tsx", "html"])
    .default("tsx")
    .describe("Code language: 'tsx' for React/JSX or 'html' for raw HTML"),
};

export function handler(_kit: Kit | null) {
  return async ({ code, language }: { code: string; language: "tsx" | "html" }) => {
    try {
      const { WebSocket } = await import("ws");

      const ws = new WebSocket(`ws://localhost:${PREVIEW_PORT}/ws`);

      const result = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Preview server connection timed out"));
        }, 5000);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "preview",
              code,
              language,
            })
          );
          clearTimeout(timeout);
          ws.close();
          resolve(`Preview updated at http://localhost:${PREVIEW_PORT}`);
        });

        ws.on("error", (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error connecting to preview server";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Could not connect to preview server: ${message}`,
              "",
              "Start the preview server first:",
              "  npx @layoutdesign/context serve",
              "",
              `Then the preview will be available at http://localhost:${PREVIEW_PORT}`,
            ].join("\n"),
          },
        ],
      };
    }
  };
}
