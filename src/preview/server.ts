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

const VIEWPORT_WIDTHS: Record<string, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

/**
 * Build a standalone HTML page for Figma capture (no chrome/iframe).
 * Optionally constrains to a viewport width for responsive captures.
 */
function buildCaptureHtml(compiledJs: string, viewportWidth?: number): string {
  const escapedJs = JSON.stringify(compiledJs)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  const containerStyle = viewportWidth
    ? `max-width: ${viewportWidth}px; margin: 0 auto; overflow: hidden;`
    : "";

  return [
    "<!DOCTYPE html>",
    "<html><head>",
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>',
    '<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>',
    '<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>',
    '<script src="https://cdn.tailwindcss.com"></script>',
    "<style>body { margin: 0; }</style>",
    "</head><body>",
    containerStyle
      ? '<div id="root" style="' + containerStyle + '"></div>'
      : '<div id="root"></div>',
    "<script>",
    "try {",
    "  var exports = {};",
    "  var module = { exports: exports };",
    "  function require(name) {",
    '    if (name === "react" || name === "React") return React;',
    '    if (name === "react-dom" || name === "react-dom/client" || name === "ReactDOM") return ReactDOM;',
    '    throw new Error("Cannot require: " + name);',
    "  }",
    "  var s = document.createElement('script');",
    "  s.textContent = " + escapedJs + ";",
    "  document.body.appendChild(s);",
    "  var Component = module.exports.default || module.exports;",
    '  if (typeof Component === "function") {',
    '    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Component));',
    "  }",
    "} catch(e) {",
    '  document.getElementById("root").textContent = e.message;',
    "}",
    "</script>",
    "</body></html>",
  ].join("\n");
}

/**
 * Start the preview HTTP + WebSocket server.
 *
 * Serves the static preview page at GET / and attaches a WebSocket server
 * for pushing live component updates.
 */
export function startPreviewServer(
  port: number = PREVIEW_PORT,
  options: { openBrowser?: boolean } = {}
): Promise<PreviewServer> {
  const { openBrowser = true } = options;

  return new Promise((resolve, reject) => {
    const htmlPath = resolveHtmlPath();
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      const url = parsedUrl.pathname;

      if (req.method === "GET" && (url === "/" || url === "")) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(htmlContent);
        return;
      }

      // Standalone capture page — renders component without preview chrome.
      // Used by Figma MCP's generate_figma_design to capture the component.
      if (req.method === "GET" && url === "/capture") {
        const last = getLastPreview();
        if (!last) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("No component previewed yet. Send code via the preview tool first.");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        const viewport = parsedUrl.searchParams.get("viewport") ?? "desktop";
        const viewportWidth = VIEWPORT_WIDTHS[viewport];
        res.end(buildCaptureHtml(last.compiledJs, viewportWidth));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    const { broadcast, getLastPreview } = createWsServer(server);

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

      if (openBrowser) {
        open(url).catch(() => {
          // Silently ignore if browser cannot be opened (e.g. SSH session)
        });
      }

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
