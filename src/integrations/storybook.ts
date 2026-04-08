import { readFile } from "node:fs/promises";

// ── Types ──────────────────────────────────────────────────────────────────

export interface StoryArg {
  name: string;
  type?: string;
  defaultValue?: string;
  description?: string;
  control?: string;
  options?: string[];
}

export interface StoryEntry {
  name: string;
  tags?: string[];
}

export interface StoryComponentMeta {
  /** Component name derived from the story title (e.g. "Button" from "Components/Button") */
  componentName: string;
  /** Full title as declared in the story meta */
  title: string;
  /** File path relative to the scan root */
  filePath: string;
  /** Args and argTypes extracted from the default export */
  args: StoryArg[];
  /** Individual stories (named exports) */
  stories: StoryEntry[];
  /** Tags declared on the meta object */
  tags?: string[];
}

// ── Regex patterns ─────────────────────────────────────────────────────────

// Match `title: "Components/Button"` or `title: 'Components/Button'`
const TITLE_RE = /title\s*:\s*["'`]([^"'`]+)["'`]/;

// Match `component: Button` or `component: "Button"`
const COMPONENT_RE = /component\s*:\s*["'`]?(\w+)["'`]?/;

// Match individual argTypes entries like:  size: { control: "select", options: ["sm", "md", "lg"] }
const ARG_TYPE_RE =
  /(\w+)\s*:\s*\{([^}]*)\}/g;

// Match `control:` value inside an argType block
const CONTROL_RE = /control\s*:\s*["'`](\w+)["'`]/;

// Match `options:` array inside an argType block
const OPTIONS_RE = /options\s*:\s*\[([^\]]*)\]/;

// Match `type:` value inside an argType block
const TYPE_RE = /type\s*:\s*["'`](\w+)["'`]/;

// Match named exports like `export const Primary: Story = ...`
const STORY_EXPORT_RE =
  /export\s+const\s+(\w+)\s*(?::\s*\w+(?:<[^>]*>)?\s*)?=/g;

// Match `tags: ["autodocs", ...]` on the meta object
const TAGS_RE = /tags\s*:\s*\[([^\]]*)\]/;

// Match `args: { ... }` on the meta object (top-level default args)
const DEFAULT_ARGS_RE = /args\s*:\s*\{([^}]*)\}/;

// ── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a single Storybook story file and extract component metadata.
 * Uses regex-based extraction (no AST required).
 */
export function parseStoryFile(
  content: string,
  filePath: string
): StoryComponentMeta | null {
  // Must have a default export (the meta object)
  if (
    !content.includes("export default") &&
    !content.includes("satisfies Meta")
  ) {
    return null;
  }

  // Extract title — required
  const titleMatch = TITLE_RE.exec(content);
  const componentMatch = COMPONENT_RE.exec(content);

  // Derive component name from title or component field
  let componentName: string | undefined;
  if (titleMatch?.[1]) {
    const parts = titleMatch[1].split("/");
    componentName = parts[parts.length - 1];
  } else if (componentMatch?.[1]) {
    componentName = componentMatch[1];
  }

  if (!componentName) return null;

  const title = titleMatch?.[1] ?? componentName;

  // Extract args from argTypes
  const args: StoryArg[] = [];
  const argTypesSection = content.match(/argTypes\s*:\s*\{([\s\S]*?)\n\s*\}/);
  if (argTypesSection?.[1]) {
    let match: RegExpExecArray | null;
    ARG_TYPE_RE.lastIndex = 0;
    while ((match = ARG_TYPE_RE.exec(argTypesSection[1])) !== null) {
      const name = match[1]!;
      const block = match[2] ?? "";

      const controlMatch = CONTROL_RE.exec(block);
      const optionsMatch = OPTIONS_RE.exec(block);
      const typeMatch = TYPE_RE.exec(block);

      const arg: StoryArg = { name };
      if (typeMatch?.[1]) arg.type = typeMatch[1];
      if (controlMatch?.[1]) arg.control = controlMatch[1];
      if (optionsMatch?.[1]) {
        arg.options = optionsMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/["'`]/g, ""))
          .filter(Boolean);
      }
      args.push(arg);
    }
  }

  // Also extract from top-level `args: { ... }` if argTypes is empty
  if (args.length === 0) {
    const defaultArgsMatch = DEFAULT_ARGS_RE.exec(content);
    if (defaultArgsMatch?.[1]) {
      const entries = defaultArgsMatch[1].split(",");
      for (const entry of entries) {
        const [key, value] = entry.split(":").map((s) => s.trim());
        if (key) {
          args.push({
            name: key,
            defaultValue: value?.replace(/["'`]/g, ""),
          });
        }
      }
    }
  }

  // Extract story names from named exports
  const stories: StoryEntry[] = [];
  let storyMatch: RegExpExecArray | null;
  STORY_EXPORT_RE.lastIndex = 0;
  while ((storyMatch = STORY_EXPORT_RE.exec(content)) !== null) {
    const name = storyMatch[1]!;
    // Skip common non-story exports
    if (name === "default" || name === "meta" || name === "Meta") continue;
    stories.push({ name });
  }

  // Extract tags
  const tagsMatch = TAGS_RE.exec(content);
  const tags = tagsMatch?.[1]
    ? tagsMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/["'`]/g, ""))
        .filter(Boolean)
    : undefined;

  return {
    componentName,
    title,
    filePath,
    args,
    stories,
    tags,
  };
}

/**
 * Parse a story file from disk.
 */
export async function parseStoryFromPath(
  filePath: string
): Promise<StoryComponentMeta | null> {
  const content = await readFile(filePath, "utf-8");
  return parseStoryFile(content, filePath);
}
