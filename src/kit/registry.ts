import type { RegistryEntry } from "./types.js";

/**
 * Local registry of available kits.
 * In Phase 2, this will fetch from superduperui.com/api/kits.
 */
const REGISTRY: RegistryEntry[] = [
  {
    name: "linear-lite",
    displayName: "Linear",
    description: "Developer tool, dark-first design system",
    tier: "free",
    aesthetic: "Dark, minimal, developer-focused",
  },
  {
    name: "stripe-lite",
    displayName: "Stripe",
    description: "Clean, trust-focused payment UI",
    tier: "free",
    aesthetic: "Light, clean, high-trust",
  },
  {
    name: "notion-lite",
    displayName: "Notion",
    description: "Typography-heavy productivity design",
    tier: "free",
    aesthetic: "Light, content-first, block-based",
  },
  // Premium kits (Phase 2)
  {
    name: "linear",
    displayName: "Linear (Full)",
    description: "Complete Linear design system — 24 components, all tokens",
    tier: "pro",
    price: "£99",
    aesthetic: "Dark, minimal, developer-focused",
  },
  {
    name: "revolut",
    displayName: "Revolut (Full)",
    description: "Complete Revolut design system — 30 components, all tokens",
    tier: "pro",
    price: "£99",
    aesthetic: "Dark fintech, data-rich",
  },
  {
    name: "stripe",
    displayName: "Stripe (Full)",
    description: "Complete Stripe design system — 20 components, all tokens",
    tier: "pro",
    price: "£79",
    aesthetic: "Light, clean, high-trust",
  },
  {
    name: "airbnb",
    displayName: "Airbnb (Full)",
    description: "Complete Airbnb design system — 25 components, all tokens",
    tier: "pro",
    price: "£99",
    aesthetic: "Warm, rounded, photo-forward",
  },
  {
    name: "notion",
    displayName: "Notion (Full)",
    description: "Complete Notion design system — 22 components, all tokens",
    tier: "pro",
    price: "£79",
    aesthetic: "Light, content-first, block-based",
  },
  {
    name: "tiktok",
    displayName: "TikTok (Full)",
    description: "Complete TikTok design system — 28 components, all tokens",
    tier: "pro",
    price: "£99",
    aesthetic: "Dark, vibrant, video-first",
  },
  {
    name: "netflix",
    displayName: "Netflix (Full)",
    description: "Complete Netflix design system — 18 components, all tokens",
    tier: "pro",
    price: "£79",
    aesthetic: "Dark, cinematic, content-forward",
  },
];

export function getRegistry(): RegistryEntry[] {
  return REGISTRY;
}

export function findKitInRegistry(name: string): RegistryEntry | undefined {
  return REGISTRY.find((entry) => entry.name === name);
}
