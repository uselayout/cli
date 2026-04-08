import { readFile, readdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import {
  parseStoryFromPath,
  type StoryComponentMeta,
} from "./storybook.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScannedProp {
  name: string;
  type?: string;
  optional?: boolean;
}

export interface ScannedComponent {
  /** PascalCase component name */
  name: string;
  /** File path relative to the scan root */
  filePath: string;
  /** How the component is exported */
  exportType: "named" | "default";
  /** Props interface/type name if detected */
  propsInterfaceName?: string;
  /** Individual prop keys extracted from the interface */
  props: ScannedProp[];
  /** Whether the component uses forwardRef */
  usesForwardRef: boolean;
  /** Storybook metadata if a matching .stories file was found */
  storybook?: StoryComponentMeta;
}

export interface ScanResult {
  /** Root directory that was scanned */
  rootPath: string;
  /** All detected React components */
  components: ScannedComponent[];
  /** Storybook stories that matched a component */
  storybookStories: StoryComponentMeta[];
  /** Stories that did not match any scanned component */
  unmatchedStories: StoryComponentMeta[];
  /** Total files scanned */
  filesScanned: number;
  /** Scan duration in milliseconds */
  durationMs: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  ".git",
  ".layout",
  ".superduper",
  "coverage",
  "__tests__",
  "__mocks__",
  ".turbo",
  ".cache",
  ".vercel",
  ".output",
]);

const COMPONENT_EXTENSIONS = new Set([".tsx", ".jsx"]);
const STORY_SUFFIXES = [".stories.ts", ".stories.tsx", ".stories.js", ".stories.jsx"];

// ── Regex patterns ─────────────────────────────────────────────────────────

// Named export: `export function Button(` or `export const Button =` or `export const Button: FC`
const NAMED_FUNCTION_RE =
  /export\s+function\s+([A-Z]\w+)\s*(?:<[^>]*>)?\s*\(/g;
const NAMED_CONST_RE =
  /export\s+const\s+([A-Z]\w+)\s*(?::\s*(?:React\.)?(?:FC|FunctionComponent|ComponentType)(?:<[^>]*>)?\s*)?=\s*/g;

// Default export: `export default function Button(`
const DEFAULT_FUNCTION_RE =
  /export\s+default\s+function\s+([A-Z]\w+)\s*(?:<[^>]*>)?\s*\(/g;

// forwardRef: `export const Button = forwardRef<` or `React.forwardRef<`
const FORWARD_REF_RE =
  /export\s+const\s+([A-Z]\w+)\s*=\s*(?:React\.)?forwardRef/g;

// Grouped export: `export { Button, Card, buttonVariants }` — capture PascalCase names only
const GROUPED_EXPORT_RE =
  /export\s*\{([^}]+)\}/g;

// Props interface: `interface ButtonProps {` or `type ButtonProps = {`
const PROPS_INTERFACE_RE =
  /(?:interface|type)\s+(\w+Props)\s*(?:=\s*)?\{([\s\S]*?)\n\}/g;

// Individual prop from interface body: `  label: string;` or `  disabled?: boolean;`
const PROP_LINE_RE =
  /^\s+(\w+)(\?)?\s*:\s*([^;]+)/gm;

// ── File discovery ─────────────────────────────────────────────────────────

function isStoryFile(filePath: string): boolean {
  return STORY_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

/**
 * Recursively walk a directory, yielding file paths.
 * Skips directories in the SKIP_DIRS set.
 */
async function* walkDir(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        yield* walkDir(fullPath);
      }
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

// ── Component extraction ───────────────────────────────────────────────────

function extractComponents(
  content: string,
  filePath: string
): ScannedComponent[] {
  const components: ScannedComponent[] = [];
  const seen = new Set<string>();

  // Extract all props interfaces/types from the file
  const propsMap = new Map<string, ScannedProp[]>();
  let propsMatch: RegExpExecArray | null;
  PROPS_INTERFACE_RE.lastIndex = 0;
  while ((propsMatch = PROPS_INTERFACE_RE.exec(content)) !== null) {
    const interfaceName = propsMatch[1]!;
    const body = propsMatch[2] ?? "";
    const props: ScannedProp[] = [];

    let propLineMatch: RegExpExecArray | null;
    PROP_LINE_RE.lastIndex = 0;
    while ((propLineMatch = PROP_LINE_RE.exec(body)) !== null) {
      props.push({
        name: propLineMatch[1]!,
        optional: propLineMatch[2] === "?",
        type: propLineMatch[3]?.trim(),
      });
    }

    propsMap.set(interfaceName, props);
  }

  function addComponent(
    name: string,
    exportType: "named" | "default",
    usesForwardRef: boolean
  ): void {
    if (seen.has(name)) return;
    seen.add(name);

    // Try to find a matching props interface
    const propsInterfaceName = `${name}Props`;
    const props = propsMap.get(propsInterfaceName) ?? [];

    components.push({
      name,
      filePath,
      exportType,
      propsInterfaceName: propsMap.has(propsInterfaceName)
        ? propsInterfaceName
        : undefined,
      props,
      usesForwardRef,
    });
  }

  // Named function exports
  let match: RegExpExecArray | null;
  NAMED_FUNCTION_RE.lastIndex = 0;
  while ((match = NAMED_FUNCTION_RE.exec(content)) !== null) {
    addComponent(match[1]!, "named", false);
  }

  // Named const exports (FC, arrow functions)
  NAMED_CONST_RE.lastIndex = 0;
  while ((match = NAMED_CONST_RE.exec(content)) !== null) {
    addComponent(match[1]!, "named", false);
  }

  // Default function exports
  DEFAULT_FUNCTION_RE.lastIndex = 0;
  while ((match = DEFAULT_FUNCTION_RE.exec(content)) !== null) {
    addComponent(match[1]!, "default", false);
  }

  // forwardRef exports
  FORWARD_REF_RE.lastIndex = 0;
  while ((match = FORWARD_REF_RE.exec(content)) !== null) {
    addComponent(match[1]!, "named", true);
  }

  // Grouped exports: `export { Button, Card, buttonVariants }`
  // Only pick PascalCase names (components), skip camelCase (utilities)
  GROUPED_EXPORT_RE.lastIndex = 0;
  while ((match = GROUPED_EXPORT_RE.exec(content)) !== null) {
    const names = match[1]!.split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim());
    for (const name of names) {
      if (/^[A-Z][a-zA-Z0-9]+$/.test(name)) {
        addComponent(name, "named", false);
      }
    }
  }

  return components;
}

// ── Main scanner ───────────────────────────────────────────────────────────

/**
 * Scan a directory for React components and Storybook stories.
 * Returns structured results with component metadata and story associations.
 */
export async function scanCodebase(rootPath: string): Promise<ScanResult> {
  const startTime = Date.now();

  const componentFiles: string[] = [];
  const storyFiles: string[] = [];
  let filesScanned = 0;

  // Collect all relevant files
  for await (const filePath of walkDir(rootPath)) {
    filesScanned++;
    const ext = extname(filePath);

    if (isStoryFile(filePath)) {
      storyFiles.push(filePath);
    } else if (COMPONENT_EXTENSIONS.has(ext)) {
      componentFiles.push(filePath);
    }
  }

  // Parse all component files
  const allComponents: ScannedComponent[] = [];
  for (const filePath of componentFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const relPath = relative(rootPath, filePath);
      const found = extractComponents(content, relPath);
      allComponents.push(...found);
    } catch {
      // Skip unreadable files
    }
  }

  // Parse all story files
  const allStories: StoryComponentMeta[] = [];
  for (const filePath of storyFiles) {
    try {
      const relPath = relative(rootPath, filePath);
      const story = await parseStoryFromPath(filePath);
      if (story) {
        // Use relative path in the result
        allStories.push({ ...story, filePath: relPath });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Match stories to components
  const matchedStoryNames = new Set<string>();
  for (const component of allComponents) {
    const matchingStory = allStories.find(
      (s) => s.componentName === component.name
    );
    if (matchingStory) {
      component.storybook = matchingStory;
      matchedStoryNames.add(matchingStory.componentName);
    }
  }

  const unmatchedStories = allStories.filter(
    (s) => !matchedStoryNames.has(s.componentName)
  );

  return {
    rootPath,
    components: allComponents,
    storybookStories: allStories,
    unmatchedStories,
    filesScanned,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Scan for Storybook stories only.
 */
export async function scanStorybook(
  rootPath: string
): Promise<StoryComponentMeta[]> {
  const stories: StoryComponentMeta[] = [];

  for await (const filePath of walkDir(rootPath)) {
    if (isStoryFile(filePath)) {
      try {
        const relPath = relative(rootPath, filePath);
        const story = await parseStoryFromPath(filePath);
        if (story) {
          stories.push({ ...story, filePath: relPath });
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return stories;
}
