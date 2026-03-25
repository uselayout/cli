import { PREVIEW_PORT } from "../kit/types.js";
import { startPreviewServer, type PreviewServer } from "./server.js";

let previewServer: PreviewServer | null = null;

/**
 * Check if an existing preview server is responding on the port.
 * Returns a stub PreviewServer if reachable, null otherwise.
 */
async function probeExistingServer(): Promise<PreviewServer | null> {
  const http = await import("node:http");
  const url = `http://localhost:${PREVIEW_PORT}`;

  return new Promise((resolve) => {
    const req = http.default.get(url, { timeout: 2000 }, (res) => {
      res.resume(); // drain response
      if (res.statusCode === 200) {
        resolve({
          url,
          broadcast: () => {},
          close: () => {},
        });
      } else {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Ensure the preview server is running. Starts it if needed. */
export async function ensurePreviewServer(): Promise<PreviewServer> {
  if (previewServer) return previewServer;

  try {
    previewServer = await startPreviewServer(undefined, { openBrowser: false });
  } catch (err) {
    // Port already in use — check if there's a working server there
    if (err instanceof Error && err.message.includes("already in use")) {
      const existing = await probeExistingServer();
      if (existing) {
        previewServer = existing;
        return previewServer;
      }
    }
    throw err;
  }

  return previewServer;
}

/** Called from MCP server startup to store the initial reference. */
export function setPreviewServer(server: PreviewServer): void {
  previewServer = server;
}
