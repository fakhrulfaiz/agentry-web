"use client";

/**
 * The Artifacts page: "Make something new" tiles that open a seeded new chat,
 * then a grid of the files the agent created in the user's chats. A card opens
 * the preview dialog.
 */
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import {
  CodeBracketIcon,
  DocumentIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  RectangleStackIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import { api, ApiError, isSignedOut } from "@/api/client";
import type { Artifact } from "@/api/types";
import { deliverableEntries, toArtifact } from "@/artifacts/artifact";
import {
  artifactKind,
  artifactUrl,
  previewMode,
  type ArtifactKind,
} from "@/artifacts/kind";
import { seedHref, type ArtifactSeedId } from "@/artifacts/seed";
import { goToLogin } from "@/chat/use-conversation";

/** Width of the page column, as on claude.ai. */
const COLUMN_WIDTH = 880;
/** Recent chats whose artifacts the page walks; Load more pulls the next page. */
const SESSIONS_PAGE = 25;

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** Accent hues; tints are mixed with transparency so they follow light and dark themes. */
const KIND_STYLE: Record<ArtifactKind, { icon: IconType; hue: string }> = {
  doc: { icon: DocumentTextIcon, hue: "#3b82f6" },
  slides: { icon: PresentationChartBarIcon, hue: "#f97316" },
  sheet: { icon: TableCellsIcon, hue: "#22a06b" },
  pdf: { icon: DocumentIcon, hue: "#e5484d" },
  code: { icon: CodeBracketIcon, hue: "#8b5cf6" },
  other: { icon: DocumentIcon, hue: "#7c8794" },
};

const tint = (hue: string, percent: number): string =>
  `color-mix(in srgb, ${hue} ${percent}%, transparent)`;

const TILES: {
  id: ArtifactSeedId;
  label: string;
  kind: ArtifactKind;
  icon: IconType;
}[] = [
  { id: "docs", label: "Docs", kind: "doc", icon: DocumentTextIcon },
  {
    id: "slides",
    label: "Slides",
    kind: "slides",
    icon: PresentationChartBarIcon,
  },
  { id: "data", label: "Data", kind: "sheet", icon: TableCellsIcon },
];

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
  tiles: { display: "flex", gap: 16, flexWrap: "wrap" },
});

function Tile({
  tile,
  onPick,
}: {
  tile: (typeof TILES)[number];
  onPick: () => void;
}) {
  const { hue } = KIND_STYLE[tile.kind];
  return (
    <button
      type="button"
      aria-label={tile.label}
      onClick={onPick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          width: 88,
          height: 88,
          borderRadius: 16,
          display: "grid",
          placeItems: "center",
          background: tint(hue, 18),
          color: hue,
        }}
      >
        <Icon icon={tile.icon} size="lg" />
      </span>
      <Text type="supporting" weight="medium">
        {tile.label}
      </Text>
    </button>
  );
}

function Preview({ artifact }: { artifact: Artifact }) {
  const kind = artifactKind(artifact);
  const { icon, hue } = KIND_STYLE[kind];
  return (
    <div
      style={{
        height: 140,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        background: tint(hue, 14),
        color: hue,
      }}
    >
      {previewMode(artifact) === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- BFF bytes; next/image does not apply
        <img
          src={artifactUrl(artifact)}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <Icon icon={icon} size="lg" />
      )}
    </div>
  );
}

function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen: () => void;
}) {
  const { icon, hue } = KIND_STYLE[artifactKind(artifact)];
  return (
    <ClickableCard
      label={artifact.name}
      onClick={onOpen}
      width="100%"
      padding={0}
    >
      <VStack>
        <Preview artifact={artifact} />
        <HStack gap={2} vAlign="center" padding={3}>
          <span style={{ color: hue, display: "flex" }}>
            <Icon icon={icon} size="sm" />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text weight="medium" maxLines={1}>
              {artifact.name}
            </Text>
            <Text type="supporting" color="secondary" maxLines={1}>
              {artifact.description ?? (
                <>
                  Updated <Timestamp value={artifact.updated_at} format="relative" />
                  {artifact.session_title ? ` · ${artifact.session_title}` : ""}
                </>
              )}
            </Text>
          </div>
        </HStack>
      </VStack>
    </ClickableCard>
  );
}

export function ArtifactsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (after?: string) => {
    try {
      const page = await api.listSessions({
        limit: SESSIONS_PAGE,
        ...(after ? { after } : {}),
      });
      // The backend keeps artifacts per session, so the page walks the recent
      // sessions; one without a workspace (404) simply contributes nothing.
      const lists = await Promise.allSettled(
        page.data.map((session) => api.listSessionDeliverables(session.id)),
      );
      const rows: Artifact[] = [];
      page.data.forEach((session, index) => {
        const result = lists[index];
        if (result.status === "fulfilled") {
          for (const entry of deliverableEntries(result.value))
            rows.push(toArtifact(session, entry));
        }
      });
      rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      setItems((rowsPrev) => (rowsPrev && after ? [...rowsPrev, ...rows] : rows));
      setHasMore(page.has_more);
      setCursor(page.data.at(-1)?.id);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin();
        return;
      }
      setError(
        err instanceof ApiError ? err.message : "Could not load artifacts.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const more = async () => {
    setLoadingMore(true);
    await load(cursor);
    setLoadingMore(false);
  };

  const retry = () => {
    setItems(null);
    void load();
  };

  const content =
    items === null && error === null ? (
      <div {...stylex.props(styles.grid)} data-testid="artifacts-loading">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height={200} index={index} />
        ))}
      </div>
    ) : items && items.length > 0 ? (
      <VStack gap={4}>
        <div {...stylex.props(styles.grid)} data-testid="artifacts-grid">
          {items.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              onOpen={() =>
                router.push(
                  `/c/${encodeURIComponent(artifact.session_id)}?file=${encodeURIComponent(artifact.path)}`,
                )
              }
            />
          ))}
        </div>
      </VStack>
    ) : items ? (
      <EmptyState
        icon={<Icon icon={RectangleStackIcon} size="lg" color="secondary" />}
        title="No artifacts yet."
        description="Files the agent creates in your chats appear here."
      />
    ) : null;


  return (
    <div
      style={{
        width: "100%",
        maxWidth: COLUMN_WIDTH,
        margin: "0 auto",
        padding: "24px 16px",
      }}
    >
      <VStack gap={4}>
        <Heading level={1} type="display-2">
          Artifacts
        </Heading>
        <HStack
          gap={1}
          vAlign="center"
          role="group"
          aria-label="Artifacts view"
        >
          <ToggleButton
            label="All"
            size="sm"
            isPressed
            onPressedChange={() => {}}
          />
        </HStack>
        <VStack gap={3}>
          <Heading level={2} type="display-3">
            Make something new
          </Heading>
          <div {...stylex.props(styles.tiles)}>
            {TILES.map((tile) => (
              <Tile
                key={tile.id}
                tile={tile}
                onPick={() => router.push(seedHref(tile.id))}
              />
            ))}
          </div>
        </VStack>
        {error !== null && (
          <Banner
            status="error"
            title={error}
            endContent={<Button label="Retry" size="sm" onClick={retry} />}
          />
        )}
        {content}
        {hasMore && (
          <HStack hAlign="center">
            <Button
              label="Load more"
              isLoading={loadingMore}
              onClick={() => void more()}
            />
          </HStack>
        )}
      </VStack>
    </div>
  );
}
