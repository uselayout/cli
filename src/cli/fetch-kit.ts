import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ingestZip } from "./import-zip.js";

/** Resolve the Layout API base. Override with LAYOUT_API_URL for local/staging. */
function apiBase(): string {
  return (process.env.LAYOUT_API_URL ?? "https://layout.design").replace(/\/$/, "");
}

export interface GalleryFetchResult {
  /** "installed" — kit ingested into .layout/; "not-found" — no such public kit; "error" — network/extract failure */
  status: "installed" | "not-found" | "error";
  /** Files copied into .layout/ (when installed) */
  imported?: string[];
  /** Human-readable detail (when error) */
  message?: string;
}

/**
 * Download a published gallery kit by slug from layout.design and ingest it
 * into .layout/. Reuses the same ZIP ingest as the `import` command, so the
 * result is identical to importing a Studio export. Never throws — returns a
 * status the caller can turn into a message.
 */
export async function fetchKitFromGallery(slug: string): Promise<GalleryFetchResult> {
  const url = `${apiBase()}/api/public/kits/${encodeURIComponent(slug)}/download`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/zip" } });
  } catch (err) {
    return {
      status: "error",
      message: `Could not reach the gallery (${(err as Error).message}).`,
    };
  }

  if (res.status === 404) {
    return { status: "not-found" };
  }
  if (!res.ok) {
    return {
      status: "error",
      message: `Gallery returned ${res.status} ${res.statusText}.`,
    };
  }

  // Save the ZIP to a temp file, then reuse the shared ingest path.
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-");
  const tmpZip = path.join(os.tmpdir(), `layout-kit-${safeSlug}-${process.pid}.zip`);
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpZip, buf);
    const { imported } = ingestZip(tmpZip);
    return { status: "installed", imported };
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }
}
