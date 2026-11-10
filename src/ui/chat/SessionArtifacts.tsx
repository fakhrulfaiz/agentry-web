'use client'

/**
 * claude.ai-style file cards above the composer: the files the agent created
 * in this chat (`GET /agents/sessions/{id}/artifacts`, re-read whenever the
 * chat goes idle). Clicking a card opens the shared preview dialog with its
 * Download. The backend item stream does not tag which turn wrote a file, so
 * the strip shows the session's files rather than per-message cards.
 */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { DocumentIcon } from '@heroicons/react/24/outline'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { Artifact } from '@/api/types'
import { artifactContentUrl } from '@/artifacts/artifact'
import { contentTypeForName } from '@/artifacts/kind'
import { ArtifactPreview } from '@/ui/artifacts/ArtifactPreview'

export function SessionArtifacts({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const [items, setItems] = useState<Artifact[]>([])
  const [selected, setSelected] = useState<Artifact | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.listSessionArtifacts(sessionId)
      setItems(
        list.data.map((entry) => {
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
          }
        }),
      )
    } catch {
      // A session without a workspace, or a fetch hiccup: no strip, silently.
      setItems([])
    }
  }, [sessionId])

  useEffect(() => {
    // Files only change when a turn runs; reload on every return to idle.
    if (enabled) void load()
  }, [enabled, load])

  if (!enabled || items.length === 0) return null

  return (
    <>
      <HStack gap={2} wrap="wrap" role="list" aria-label="Files in this chat" data-testid="chat-artifacts">
        {items.map((artifact) => (
          <Button
            key={artifact.id}
            size="sm"
            variant="secondary"
            label={artifact.name}
            aria-label={`File ${artifact.name}`}
            icon={<Icon icon={DocumentIcon} size="sm" />}
            onClick={() => setSelected(artifact)}
          />
        ))}
      </HStack>
      <ArtifactPreview
        artifact={selected}
        onClose={() => setSelected(null)}
        onOpenChat={() => window.location.assign(`/c/${encodeURIComponent(sessionId)}`)}
      />
    </>
  )
}
