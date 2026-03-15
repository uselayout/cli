import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import chalk from "chalk";

// Ports commonly occupied by VSCode, Next.js, Vite, etc. — skip these
const SKIP_PORTS = new Set([3000, 3001, 3002, 4321, 5173, 8080, 8081]);
const DEFAULT_PORT_RANGE_START = 8765;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function findFreePort(start: number): Promise<number> {
  let port = start;
  while (port < start + 100) {
    if (!SKIP_PORTS.has(port) && (await isPortFree(port))) {
      return port;
    }
    port++;
  }
  throw new Error("Could not find a free port in range");
}

function waitForServer(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");

    function poll() {
      try {
        execFileSync("curl", ["-sf", "-o", "/dev/null", "--max-time", "1", url], {
          stdio: "ignore",
        });
        resolve(true);
      } catch {
        if (Date.now() > deadline) {
          resolve(false);
        } else {
          setTimeout(poll, 200);
        }
      }
    }
    poll();
  });
}

export async function serveLocalCommand(targetPath: string, options: { port?: number; quiet?: boolean }): Promise<void> {
  const absTarget = path.resolve(process.cwd(), targetPath);

  if (!fs.existsSync(absTarget)) {
    console.log(chalk.red("Error:"), `Path not found: ${absTarget}`);
    process.exit(1);
  }

  const isFile = fs.statSync(absTarget).isFile();
  const directory = isFile ? path.dirname(absTarget) : absTarget;
  const filePart = isFile ? path.basename(absTarget) : "";

  // Resolve port
  let port: number;
  if (options.port) {
    const free = await isPortFree(options.port);
    if (!free) {
      console.log(chalk.red("Error:"), `Port ${options.port} is already in use. Try a different port with --port <n>.`);
      process.exit(1);
    }
    port = options.port;
  } else {
    port = await findFreePort(DEFAULT_PORT_RANGE_START);
  }

  const url = `http://localhost:${port}${filePart ? `/${filePart}` : ""}`;

  // Start a detached Python HTTP server (survives shell session death)
  const child = spawn(
    "python3",
    ["-m", "http.server", String(port), "--directory", directory],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  child.unref();

  // Wait for it to be ready
  const baseUrl = `http://localhost:${port}/`;
  const ready = await waitForServer(baseUrl);

  if (!ready) {
    console.log(chalk.red("Error:"), "Server did not start in time. Check that python3 is available.");
    process.exit(1);
  }

  if (!options.quiet) {
    console.log();
    console.log(chalk.bold("  Layout — Local file server"));
    console.log();
    console.log(chalk.green("  ✓"), `Serving on ${chalk.cyan(url)}`);
    console.log(chalk.dim("    Directory:"), directory);
    console.log(chalk.dim("    PID:"), child.pid ?? "unknown");
    console.log();
    console.log(chalk.yellow("  →"), "Pass this URL to", chalk.cyan("url-to-figma"), "or open it in your browser");
    console.log();
    console.log(chalk.dim("  Note: file:// URLs are not supported by the Figma capture script."));
    console.log(chalk.dim("        This HTTP server is required even for static HTML files."));
    console.log();
    console.log(chalk.dim(`  To stop: kill ${child.pid ?? "<PID>"}`));
    console.log();
  } else {
    // Machine-readable output for scripting
    console.log(url);
  }
}
