/** Connector catalog types and pure list logic; safe for server and browser. */

/** One connector as the Connectors page shows it. */
export interface CatalogEntry {
  slug: string;
  name: string;
  category: string;
  toolCount: number;
}

/** Cards shown before "Show more". */
export const PAGE_SIZE = 24;
/** Category chips shown besides "All". */
export const TOP_CATEGORIES = 8;

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Validates one external catalog row; returns null when it is unusable. */
export function parseEntry(raw: unknown): CatalogEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const { slug, name, category, toolCount } = row;
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  if (typeof name !== "string" || !name.trim()) return null;
  return {
    slug,
    name: name.trim().slice(0, 80),
    category: typeof category === "string" ? category.trim().slice(0, 60) : "",
    toolCount:
      typeof toolCount === "number" &&
      Number.isFinite(toolCount) &&
      toolCount >= 0
        ? Math.floor(toolCount)
        : 0,
  };
}

/** Logo URL for a validated slug. */
export const logoUrl = (slug: string): string =>
  `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;

/** Sentence-case label for a lowercase category such as "developer tools". */
const ACRONYMS = new Set(["crm", "ai", "api", "hr", "seo", "sms", "erp", "cms", "it"]);

/** "crm" → "CRM", "developer tools" → "Developer tools", "" → "Other". */
export function categoryLabel(category: string): string {
  if (!category) return "Other";
  const words = category.split(" ").map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w));
  const first = words[0] ?? "";
  words[0] = ACRONYMS.has(first.toLowerCase()) ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

/** The most common categories, most populated first. */
export function topCategories(
  entries: readonly CatalogEntry[],
  limit = TOP_CATEGORIES,
): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries)
    if (entry.category)
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category]) => category);
}

/** Entries matching a case-insensitive query (name, slug, category) and an optional exact category. */
export function filterEntries(
  entries: readonly CatalogEntry[],
  query: string,
  category: string | null,
): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (category === null || e.category === category) &&
      (q === "" ||
        e.name.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)),
  );
}

/** Entries for the featured slugs, in the configured order; unknown slugs are skipped. */
export function pickFeatured(
  entries: readonly CatalogEntry[],
  slugs: readonly string[],
): CatalogEntry[] {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  return slugs.flatMap((slug) => bySlug.get(slug) ?? []);
}

/** Maximum prefill length accepted from `?prompt=`. */
export const PROMPT_MAX = 200;

/** A composer prefill from a `prompt` query value: control characters removed, trimmed, length-limited. */
export function promptText(value: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, PROMPT_MAX);
}

/** New-chat URL that prefills asking the agent to connect an account. */
export const connectHref = (name: string): string =>
  `/?prompt=${encodeURIComponent(`Connect my ${name} account`)}`;
