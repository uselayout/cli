export interface KitManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  source: string;
  tier: "free" | "pro";
  tokenCount: number;
  componentCount: number;
  aesthetic: string;
  layoutUrl?: string;
}

export interface KitSection {
  id: string;
  title: string;
  content: string;
}

export interface KitComponent {
  name: string;
  description: string;
  tokens: string[];
  codeExample?: string;
}

export interface Kit {
  manifest: KitManifest;
  designMd: string;
  sections: KitSection[];
  components: KitComponent[];
  tokensCss?: string;
  tokensJson?: string;
  tailwindConfig?: string;
}

export interface RegistryEntry {
  name: string;
  displayName: string;
  description: string;
  tier: "free" | "pro";
  price?: string;
  aesthetic: string;
}

export const LAYOUT_DIR = ".layout";
export const LEGACY_DIR = ".superduper"; // Deprecated — remove in v1.0
export const KIT_MANIFEST_FILE = "kit.json";
export const DESIGN_MD_FILE = "DESIGN.md";
export const TOKENS_CSS_FILE = "tokens.css";
export const TOKENS_JSON_FILE = "tokens.json";
export const TAILWIND_CONFIG_FILE = "tailwind.config.js";
export const COMPONENTS_DIR = "components";

export const PREVIEW_PORT = 4321;
export const REGISTRY_URL = "https://layout.design/api/kits";
