import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { createWsServer } from "./ws.js";
import { PREVIEW_PORT } from "../kit/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the index.html path — works from both src/ (dev) and dist/ (published). */
function resolveHtmlPath(): string {
  // When running from dist/, the file is at dist/preview/static/index.html
  // When running from src/, it's at src/preview/static/index.html
  const candidates = [
    path.join(__dirname, "static", "index.html"),
    path.join(__dirname, "..", "src", "preview", "static", "index.html"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find preview index.html. Searched:\n${candidates.join("\n")}`
  );
}

export interface PreviewServer {
  url: string;
  broadcast: (code: string, compiledJs: string) => void;
  close: () => void;
}

/**
 * Start the preview HTTP + WebSocket server.
 *
 * Serves the static preview page at GET / and attaches a WebSocket server
 * for pushing live component updates.
 */
export function startPreviewServer(
  port: number = PREVIEW_PORT
): Promise<PreviewServer> {
  return new Promise((resolve, reject) => {
    const htmlPath = resolveHtmlPath();
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url === "")) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(htmlContent);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    const { broadcast } = createWsServer(server);

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Stop the other process or use a different port.`
          )
        );
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;

      // Open browser (fire-and-forget)
      open(url).catch(() => {
        // Silently ignore if browser cannot be opened (e.g. SSH session)
      });

      resolve({
        url,
        broadcast,
        close: () => {
          server.close();
        },
      });
    });
  });
}
