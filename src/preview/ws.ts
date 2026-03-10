import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { transpileTsx } from "./transpile.js";

export interface WsBroadcaster {
  broadcast: (code: string, compiledJs: string) => void;
  getLastPreview: () => { code: string; compiledJs: string } | null;
}

/**
 * Create a WebSocket server attached to the given HTTP server.
 * Returns a broadcast function that pushes updates to all connected clients.
 *
 * Also handles incoming { type: "preview", code, language } messages from MCP tools:
 * transpiles TSX server-side and broadcasts the compiled result to all preview clients.
 */
export function createWsServer(server: http.Server): WsBroadcaster {
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();
  let lastPreview: { code: string; compiledJs: string } | null = null;

  wss.on("connection", (ws) => {
    clients.add(ws);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as {
          type?: string;
          code?: string;
          language?: string;
        };

        if (msg.type === "preview" && msg.code) {
          const language = msg.language ?? "tsx";
          let compiledJs = msg.code;

          if (language === "tsx" || language === "jsx" || language === "ts") {
            const result = transpileTsx(msg.code);
            if (result.error) {
              // Send error back to the sender
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `Transpilation failed: ${result.error}`,
                })
              );
              return;
            }
            compiledJs = result.js;
          }

          // Broadcast to all OTHER clients (the preview page)
          broadcast(msg.code, compiledJs);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  function broadcast(code: string, compiledJs: string): void {
    lastPreview = { code, compiledJs };
    const payload = JSON.stringify({ type: "update", code, compiledJs });

    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  function getLastPreview() {
    return lastPreview;
  }

  return { broadcast, getLastPreview };
}
