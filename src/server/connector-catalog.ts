import "server-only";

import {
  parseEntry,
  pickFeatured,
  type CatalogEntry,
} from "@/connectors/catalog";

const CATALOG_URL = "https://docs.composio.dev/data/toolkits-list.json";
const DEFAULT_FEATURED = ["gmail", "github", "googledrive", "googlecalendar"];
const REVALIDATE_SECONDS = 24 * 60 * 60;

/** Used when the catalog cannot be fetched. */
const FALLBACK: CatalogEntry[] = [
  ["gmail", "Gmail", "email"],
  ["github", "GitHub", "developer tools"],
  ["googledrive", "Google Drive", "documents"],
  ["googlecalendar", "Google Calendar", "scheduling & booking"],
  ["slack", "Slack", "team chat"],
  ["notion", "Notion", "productivity"],
  ["linear", "Linear", "project management"],
  ["googlesheets", "Google Sheets", "spreadsheets"],
].map(([slug, name, category]) => ({ slug, name, category, toolCount: 0 }));

export interface Catalog {
  entries: CatalogEntry[];
  featured: CatalogEntry[];
  /** True when the live catalog was unavailable and the bundled list is shown. */
  failed: boolean;
}

/** Featured slugs from `AGENTRY_WEB_CONNECTORS_FEATURED` (comma list); the default four when unset or empty. */
export function featuredSlugs(env: NodeJS.ProcessEnv = process.env): string[] {
  const slugs = (env.AGENTRY_WEB_CONNECTORS_FEATURED ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return slugs.length > 0 ? slugs : DEFAULT_FEATURED;
}

/** Parses the external JSON; null unless it is an array with at least one valid row. Invalid rows are dropped. */
export function parseCatalog(json: unknown): CatalogEntry[] | null {
  if (!Array.isArray(json)) return null;
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const raw of json) {
    const entry = parseEntry(raw);
    if (entry && !seen.has(entry.slug)) {
      seen.add(entry.slug);
      entries.push(entry);
    }
  }
  return entries.length > 0 ? entries : null;
}

/** Loads the connector catalog (cached 24 h by Next); falls back to a bundled list with `failed: true`. */
export async function getCatalog(): Promise<Catalog> {
  const featuredList = featuredSlugs();
  try {
    const res = await fetch(CATALOG_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`catalog responded ${res.status}`);
    const entries = parseCatalog(await res.json());
    if (!entries) throw new Error("catalog has no usable rows");
    return {
      entries,
      featured: pickFeatured(entries, featuredList),
      failed: false,
    };
  } catch (error) {
    console.warn(
      "connector catalog unavailable; using the bundled list",
      error instanceof Error ? error.message : error,
    );
    return {
      entries: FALLBACK,
      featured: pickFeatured(FALLBACK, featuredList),
      failed: true,
    };
  }
}
