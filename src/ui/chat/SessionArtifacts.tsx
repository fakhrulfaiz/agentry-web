'use client'

/**
 * claude.ai-style file cards at the end of the chat (like Claude Code's
 * trailing attachments): the files the agent delivered with `present` in this chat
 * (`GET /agents/sessions/{id}/deliverables`, re-read whenever the chat goes
 * idle). Clicking a card opens the shared preview dialog with its Download.
 * The backend item stream does not tag which turn wrote a file, so the strip
 * shows the session's files rather than per-message cards.
 */
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import {
  ArrowDownTrayIcon,
  CodeBracketIcon,
  DocumentIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from 'react'
import { api } from '@/api/client'
import type { Artifact } from '@/api/types'
import { artifactContentUrl, deliverableEntries } from '@/artifacts/artifact'
import { artifactKind, artifactUrl, contentTypeForName, previewMode, type ArtifactKind } from '@/artifacts/kind'
import { usePreviewPanel } from '@/preview/store'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const KIND_LABEL: Record<ArtifactKind, string> = {
  doc: 'Document',
  slides: 'Presentation',
  sheet: 'Spreadsheet',
  pdf: 'PDF',
  code: 'Code',
  other: 'File',
}

const KIND_ICON: Record<ArtifactKind, IconType> = {
  doc: DocumentTextIcon,
  slides: PresentationChartBarIcon,
  sheet: TableCellsIcon,
  pdf: DocumentIcon,
  code: CodeBracketIcon,
  other: DocumentIcon,
}

const styles = stylex.create({
  grid: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))' },
    maxWidth: 560,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
    paddingInlineEnd: 8,
    backgroundColor: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
  },
  open: {
    all: 'unset',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
    padding: 12,
    cursor: 'pointer',
    borderRadius: radiusVars['--radius-container'],
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colorVars['--color-accent'],
  },
  tile: {
    flexShrink: 0,
    width: 40,
    height: 40,
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    borderRadius: radiusVars['--radius-inner'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  thumb: { width: '100%', height: '100%', objectFit: 'cover' },
  text: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' },
})

/** One file card: icon or image thumbnail, name and type, a download button. Shared with the files on user messages. */
export function FileCard({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  const kind = artifactKind(artifact)
  const ext = artifact.name.includes('.') ? artifact.name.split('.').pop()!.toUpperCase() : ''
  return (
    <li {...stylex.props(styles.card)} data-testid="chat-artifact-card">
      <button type="button" aria-label={`File ${artifact.name}`} onClick={onOpen} {...stylex.props(styles.open)}>
        <span {...stylex.props(styles.tile)}>
          {previewMode(artifact) === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element -- BFF bytes; next/image does not apply
            <img src={artifactUrl(artifact)} alt="" loading="lazy" {...stylex.props(styles.thumb)} />
          ) : (
            <Icon icon={KIND_ICON[kind]} size="md" />
          )}
        </span>
        <span {...stylex.props(styles.text)}>
          <Text weight="medium" maxLines={1}>
            {artifact.name}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {artifact.description ?? (ext ? `${KIND_LABEL[kind]} · ${ext}` : KIND_LABEL[kind])}
          </Text>
        </span>
      </button>
      <Button
        label={`Download ${artifact.name}`}
        variant="ghost"
        size="sm"
        isIconOnly
        icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
        href={artifactUrl(artifact, true)}
      />
    </li>
  )
}

/** `idle` is false while a turn runs; the list is re-read each time it turns true again. */
export function SessionArtifacts({ sessionId, enabled, idle = true }: { sessionId: string; enabled: boolean; idle?: boolean }) {
  const [items, setItems] = useState<Artifact[]>([])
  const { actions } = usePreviewPanel()

  const load = useCallback(async () => {
    try {
      const list = await api.listSessionDeliverables(sessionId)
      setItems(
        deliverableEntries(list)
          .map((entry) => {
          const name = entry.path.split('/').pop() ?? entry.path
          return {
            id: `${sessionId}:${entry.path}`,
            name,
            path: entry.path,
            size: entry.size ?? 0,
            mime_type: contentTypeForName(name),
            session_id: sessionId,
            updated_at: entry.last_modified ?? '',
            content_url: artifactContentUrl(sessionId, entry.path),
            ...(entry.description ? { description: entry.description } : {}),
          }
        })
          // Newest first; the backend gives no per-turn attribution.
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
      )
    } catch {
      // A session without a workspace, or a fetch hiccup: no strip, silently.
      setItems([])
    }
  }, [sessionId])

  useEffect(() => {
    // Files only change when a turn runs; reload on every return to idle.
    if (enabled && idle) void load()
  }, [enabled, idle, load])

  if (!enabled || items.length === 0) return null

  return (
    <>
      <ul {...stylex.props(styles.grid)} aria-label="Files in this chat" data-testid="chat-artifacts">
        {items.map((artifact) => (
          <FileCard key={artifact.id} artifact={artifact} onOpen={() => actions.openFile(artifact.path)} />
        ))}
      </ul>
    </>
  )
}
