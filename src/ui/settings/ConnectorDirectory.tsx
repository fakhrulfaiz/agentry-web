"use client";

/**
 * Settings > Connectors directory: a searchable list of connectors. Connect opens a
 * new chat with a prefilled message. Rendered only when a connector key is saved;
 * `connected` lists slugs with an active account, or is null when that is unknown.
 */
import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState } from "react";
import {
  categoryLabel,
  connectHref,
  filterEntries,
  logoUrl,
  PAGE_SIZE,
  topCategories,
  type CatalogEntry,
} from "@/connectors/catalog";

const LOGO_SIZE = 40;

const styles = stylex.create({
  grid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 640px)": "repeat(2, minmax(0, 1fr))",
      "@media (min-width: 900px)": "repeat(3, minmax(0, 1fr))",
    },
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 8 },
  textCell: { minWidth: 0, flex: 1 },
});

/** Decorative logo; falls back to a letter avatar when the image fails to load. */
function Logo({ entry }: { entry: CatalogEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return <Avatar name={entry.name} size={LOGO_SIZE} tooltip={false} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external logo host; next/image does not apply
    <img
      src={logoUrl(entry.slug)}
      alt=""
      width={LOGO_SIZE}
      height={LOGO_SIZE}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ flex: "none", objectFit: "contain", borderRadius: 8 }}
    />
  );
}

function ConnectorCard({
  entry,
  connected,
}: {
  entry: CatalogEntry;
  connected: boolean;
}) {
  const detail = [
    categoryLabel(entry.category),
    entry.toolCount > 0 ? `${entry.toolCount} tools` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Card padding={4}>
        <VStack gap={3}>
          <HStack gap={3} vAlign="center">
            <Logo entry={entry} />
            <div {...stylex.props(styles.textCell)}>
              <Text weight="medium" maxLines={1}>
                {entry.name}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {detail}
              </Text>
            </div>
          </HStack>
          {connected ? (
            <Text type="supporting" color="secondary">
              Connected
            </Text>
          ) : (
            <Button
              href={connectHref(entry.name)}
              label="Connect"
              aria-label={`Connect ${entry.name}`}
              variant="secondary"
              size="sm"
            />
          )}
        </VStack>
      </Card>
    </li>
  );
}

function Grid({
  entries,
  connected,
  label,
}: {
  entries: CatalogEntry[];
  connected: Set<string>;
  label: string;
}) {
  return (
    <ul
      {...stylex.props(styles.grid)}
      aria-label={label}
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      {entries.map((entry) => (
        <ConnectorCard
          key={entry.slug}
          entry={entry}
          connected={connected.has(entry.slug)}
        />
      ))}
    </ul>
  );
}

export function ConnectorDirectory({
  entries,
  featured,
  failed,
}: {
  entries: CatalogEntry[];
  featured: CatalogEntry[];
  failed: boolean;
}) {
  // Connected status needs a slow upstream call, so it loads after the page paints.
  const [connected, setConnected] = useState<string[] | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/agentry/connectors/status", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { connected?: string[] | null } | null) =>
        setConnected(j?.connected ?? null),
      )
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const connectedSet = useMemo(() => new Set(connected ?? []), [connected]);
  const categories = useMemo(() => topCategories(entries), [entries]);
  const connectedEntries = useMemo(
    () => entries.filter((e) => connectedSet.has(e.slug)),
    [entries, connectedSet],
  );
  const filtering = query.trim() !== "" || category !== null;
  const results = useMemo(
    () => filterEntries(entries, query, category),
    [entries, query, category],
  );

  return (
    <VStack gap={5}>
      {failed && (
        <Banner
          status="warning"
          title="The full connector list is unavailable right now. Showing popular connectors instead."
        />
      )}

      <VStack gap={3}>
        <TextInput
          label="Search connectors"
          isLabelHidden
          placeholder="Search connectors"
          type="search"
          htmlName="connector-search"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setVisible(PAGE_SIZE);
          }}
        />
        <div
          {...stylex.props(styles.chips)}
          role="group"
          aria-label="Categories"
        >
          {[null, ...categories].map((c) => (
            <ToggleButton
              key={c ?? "all"}
              label={c === null ? "All" : categoryLabel(c)}
              size="sm"
              isPressed={category === c}
              onPressedChange={() => {
                setCategory(c);
                setVisible(PAGE_SIZE);
              }}
            />
          ))}
        </div>
      </VStack>

      {!filtering && connectedEntries.length > 0 && (
        <VStack gap={3} as="section" aria-labelledby="connectors-connected">
          <Heading level={2} type="display-3" id="connectors-connected">
            Connected
          </Heading>
          <Grid
            entries={connectedEntries}
            connected={connectedSet}
            label="Connected connectors"
          />
        </VStack>
      )}

      {!filtering && featured.length > 0 && (
        <VStack gap={3} as="section" aria-labelledby="connectors-featured">
          <Heading level={2} type="display-3" id="connectors-featured">
            Featured
          </Heading>
          <Grid
            entries={featured}
            connected={connectedSet}
            label="Featured connectors"
          />
        </VStack>
      )}

      <VStack gap={3} as="section" aria-labelledby="connectors-all">
        <Heading level={2} type="display-3" id="connectors-all">
          {filtering ? "Results" : "All connectors"}
        </Heading>
        {results.length === 0 ? (
          <Text type="supporting" color="secondary" role="status">
            No connectors match your search.
          </Text>
        ) : (
          <>
            <Grid
              entries={results.slice(0, visible)}
              connected={connectedSet}
              label="Connectors"
            />
            {results.length > visible && (
              <HStack hAlign="center">
                <Button
                  label="Show more"
                  onClick={() => setVisible((n) => n + PAGE_SIZE)}
                />
              </HStack>
            )}
          </>
        )}
      </VStack>
    </VStack>
  );
}
