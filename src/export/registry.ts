/**
 * Kit → shadcn registry item.
 *
 * Turns a Layout kit into a shadcn-compatible registry item JSON so anyone can
 * install it with the stock shadcn CLI:
 *
 *   npx shadcn@latest add https://raw.githubusercontent.com/uselayout/layout-context/main/registry/linear-lite/registry.json
 *
 * The item is a `registry:base` style entry: cssVars carry the kit's tokens
 * (root-mode under `theme`, dark-mode under `dark`), and the kit files
 * (layout.md, tokens.css, tokens.json, kit.json) install into `.layout/` via
 * `registry:file` targets, so the Layout MCP server picks the kit up too.
 */
import type { Kit } from "../kit/types.js";
import { parseCssVariables } from "./kit-tokens.js";

export interface RegistryItemFileJson {
  path: string;
  type: string;
  target: string;
  content: string;
}

export interface KitRegistryItemJson {
  $schema: string;
  name: string;
  type: string;
  title: string;
  description: string;
  author?: string;
  cssVars: {
    theme?: Record<string, string>;
    dark?: Record<string, string>;
  };
  files: RegistryItemFileJson[];
}

const ITEM_SCHEMA = "https://ui.shadcn.com/schema/registry-item.json";

function kitFile(
  kitName: string,
  fileName: string,
  content: string
): RegistryItemFileJson {
  return {
    path: `registry/${kitName}/.layout/${fileName}`,
    type: "registry:file",
    // `~/` = project root in shadcn target resolution.
    target: `~/.layout/${fileName}`,
    content,
  };
}

/** Build the shadcn registry item for a loaded kit. */
export function generateKitRegistryItem(kit: Kit): KitRegistryItemJson {
  const { name, displayName, description } = kit.manifest;

  const theme: Record<string, string> = {};
  const dark: Record<string, string> = {};
  if (kit.tokensCss) {
    for (const v of parseCssVariables(kit.tokensCss)) {
      if (v.mode === "dark") dark[v.name] = v.value;
      else theme[v.name] = v.value;
    }
  }

  const cssVars: KitRegistryItemJson["cssVars"] = {};
  if (Object.keys(theme).length > 0) cssVars.theme = theme;
  if (Object.keys(dark).length > 0) cssVars.dark = dark;

  const files: RegistryItemFileJson[] = [];
  files.push(kitFile(name, "layout.md", kit.layoutMd));
  if (kit.tokensCss) files.push(kitFile(name, "tokens.css", kit.tokensCss));
  if (kit.tokensJson) files.push(kitFile(name, "tokens.json", kit.tokensJson));
  files.push(
    kitFile(name, "kit.json", JSON.stringify(kit.manifest, null, 2) + "\n")
  );

  return {
    $schema: ITEM_SCHEMA,
    name,
    type: "registry:base",
    title: displayName,
    description,
    author: "Layout <https://layout.design>",
    cssVars,
    files,
  };
}

/** Serialise the registry item with stable formatting. */
export function renderKitRegistryItem(kit: Kit): string {
  return JSON.stringify(generateKitRegistryItem(kit), null, 2) + "\n";
}
