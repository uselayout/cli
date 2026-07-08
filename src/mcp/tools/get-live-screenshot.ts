/**
 * MCP tool: get-live-screenshot
 *
 * Returns a screenshot from layout Live (desktop app) as an MCP image:
 *
 * - With `requestId`: the PNG captured when that AI request was filed, read
 *   from `.layout/live/screenshots/<id>.png`. Works even when Live is not
 *   running. Requests that have one carry `screenshot: "screenshots/<id>.png"`
 *   in the `get-pending-requests` output.
 * - Without `requestId`: a fresh capture of the page currently open in Live,
 *   fetched over Live's unix socket (`capture-screenshot`). Needs Live
 *   running with a page attached.
 */
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { connectToLive } from "./_live-socket.js";

export const name = "get-live-screenshot";

export const description =
  "Returns a screenshot from layout Live (desktop app) as an image. Pass the " +
  "id of a pending request (from get-pending-requests) to see the page as it " +
  "looked when the user filed that request: essential for visual asks like " +
  "'make it look like the mockup'. Call it with no requestId for a fresh " +
  "screenshot of the page currently open in Live (requires Live to be " +
  "running). Request screenshots are read from disk, so they work even when " +
  "Live is closed.";

export const inputSchema = {
  requestId: z
    .string()
    .optional()
    .describe(
      "Id of a Live request (from get-pending-requests) whose stored " +
        "screenshot to return. Omit to capture a fresh screenshot of the " +
        "page currently open in Live."
    ),
};

type Input = { requestId?: string };

const SCREENSHOTS_DIR = path.join(".layout", "live", "screenshots");

/** Ids are UUID-ish file-name material; anything else must never hit the fs. */
function safeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function textError(text: string) {
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}

function imageResult(data: string, mimeType: string, caption: string) {
  return {
    content: [
      { type: "text" as const, text: caption },
      { type: "image" as const, data, mimeType },
    ],
  };
}

async function storedScreenshot(projectRoot: string, requestId: string) {
  if (!safeId(requestId)) {
    return textError(
      `Invalid requestId "${requestId}". Pass a request id exactly as ` +
        "returned by the get-pending-requests tool."
    );
  }
  const file = path.join(projectRoot, SCREENSHOTS_DIR, `${requestId}.png`);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(file);
  } catch {
    return textError(
      `No screenshot stored for request ${requestId} (looked for ` +
        `${path.join(SCREENSHOTS_DIR, `${requestId}.png`)}). Screenshots are ` +
        "captured when a request is filed in the Live desktop app; requests " +
        "filed while Live ran headless have none. Requests that have one " +
        'carry a "screenshot" field in the get-pending-requests output.'
    );
  }
  return imageResult(
    buffer.toString("base64"),
    "image/png",
    `Screenshot captured when request ${requestId} was filed:`
  );
}

async function freshScreenshot(projectRoot: string) {
  const live = await connectToLive(projectRoot);
  if (!live) {
    return textError(
      "layout Live is not running for this project, so a fresh screenshot " +
        "cannot be captured. Open the project in the Live desktop app and " +
        "try again, or pass a requestId to read a stored request screenshot " +
        "from .layout/live/screenshots/."
    );
  }
  try {
    const shot = await live.send<{ data?: string; mimeType?: string }>({
      method: "capture-screenshot",
    });
    if (!shot?.data) {
      return textError(
        "Live is running but returned no screenshot (no page loaded yet)."
      );
    }
    return imageResult(
      shot.data,
      shot.mimeType ?? "image/jpeg",
      "Fresh screenshot of the page currently open in layout Live:"
    );
  } catch (e) {
    return textError(
      `Live could not capture a screenshot: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  } finally {
    live.close();
  }
}

export function handler() {
  return async (input: Input) => {
    const projectRoot = process.cwd();
    return input.requestId
      ? storedScreenshot(projectRoot, input.requestId)
      : freshScreenshot(projectRoot);
  };
}
