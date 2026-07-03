/**
 * `list-ui-components` MCP tool — surface the pre-built Layout UI catalogue.
 *
 * Fetches the Layout UI registry index (`<registry>/registry.json`, honouring
 * LAYOUT_REGISTRY) and returns a concise, machine-readable list of installable
 * components. The point is to stop agents hand-rolling a Button/Dialog/Input
 * when a token-contracted one is one `add` command away.
 *
 * The network is injectable and the formatter is pure so both stay unit-testable.
 * Fetch failures degrade gracefully: the handler returns a helpful error string
 * rather than throwing, so an agent's flow isn't broken by a flaky registry.
 */
import {
  resolveRegistryBase,
  type RegistryIndex,
  type RegistryItem,
} from "../../registry/index.js";

export const name = "list-ui-components";

export const description =
  "List the pre-built, token-contracted Layout UI components installable into " +
  "this project. Use before writing UI primitives from scratch. Returns each " +
  "component's name, title, description, an install command " +
  "(`npx @layoutdesign/context add <name>`), and — where available — usage " +
  "guidance and hard 'never' rules.";

export const inputSchema = {};

/** How long to wait on the registry before giving up. */
const FETCH_TIMEOUT_MS = 10_000;

/** A fetcher returning the parsed registry index, injected so tests can mock it. */
export type IndexFetcher = (url: string) => Promise<RegistryIndex>;

/**
 * Process-lifetime cache of resolved indexes, keyed by registry URL. The
 * registry catalogue changes rarely and an agent may call this repeatedly in a
 * session, so caching avoids redundant network round-trips.
 */
const indexCache = new Map<string, RegistryIndex>();

/** Clear the in-memory index cache. Exposed for tests. */
export function _clearIndexCache(): void {
  indexCache.clear();
}

/** Default fetcher: `fetch` with a 10s abort timeout. */
async function defaultFetcher(url: string): Promise<RegistryIndex> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`registry returned ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as RegistryIndex;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch (and cache) the registry index. `fetcher` is injectable for tests.
 * Cached results are returned without hitting the network again.
 */
export async function fetchRegistryIndex(
  registryBase: string,
  fetcher: IndexFetcher = defaultFetcher
): Promise<RegistryIndex> {
  const url = `${registryBase}/registry.json`;
  const cached = indexCache.get(url);
  if (cached) return cached;
  const index = await fetcher(url);
  indexCache.set(url, index);
  return index;
}

/** Format a single registry item into its catalogue entry. */
function formatItem(item: RegistryItem): string {
  const lines: string[] = [];
  const title = item.title ? ` — ${item.title}` : "";
  lines.push(`### ${item.name}${title}`);
  if (item.description) lines.push(item.description);
  lines.push(`Install: \`npx @layoutdesign/context add ${item.name}\``);

  const usage = item.meta?.usage;
  if (usage) lines.push(`Usage: ${usage}`);

  const never = item.meta?.never;
  if (never && never.length > 0) {
    lines.push("Never:");
    for (const rule of never) lines.push(`- ${rule}`);
  }

  return lines.join("\n");
}

/**
 * Render the registry index into a concise, agent-readable catalogue. Only
 * installable UI components are listed (themes and other non-`registry:ui`
 * entries are skipped).
 */
export function formatCatalogue(index: RegistryIndex): string {
  const components = (index.items ?? []).filter(
    (i) => (i.type ?? "registry:ui").startsWith("registry:ui")
  );

  if (components.length === 0) {
    return "No Layout UI components are currently available in the registry.";
  }

  const header =
    `# Layout UI components (${components.length})\n\n` +
    "Pre-built, token-contracted components you can install instead of writing " +
    "primitives from scratch. Each is themeable via the Layout token contract " +
    "(every gallery kit is a theme). Install one with the command shown, then " +
    "import it from your components directory.\n";

  const body = components.map(formatItem).join("\n\n");

  return `${header}\n${body}`;
}

export function handler(fetcher: IndexFetcher = defaultFetcher) {
  return async () => {
    const registryBase = resolveRegistryBase();
    try {
      const index = await fetchRegistryIndex(registryBase, fetcher);
      return {
        content: [{ type: "text" as const, text: formatCatalogue(index) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Could not reach the Layout UI registry at ${registryBase}/registry.json (${msg}). ` +
              "You can still install components directly if you know the name: " +
              "`npx @layoutdesign/context add button`. See https://ui.staging.layout.design for the full catalogue.",
          },
        ],
      };
    }
  };
}
