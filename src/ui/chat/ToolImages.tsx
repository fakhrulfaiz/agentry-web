'use client'

/**
 * Images a tool returned (a screenshot, `read_image`): thumbnails in the expanded tool card; a click
 * opens the shared preview dialog with the full image. Bytes come through the BFF, never a direct API URL.
 */
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { Artifact, OAIOutputImagePart } from '@/api/types'
import { artifactUrl } from '@/artifacts/kind'
import { fileContentPath } from '@/chat/attachments'
import { ArtifactPreview } from '@/ui/artifacts/ArtifactPreview'

const styles = stylex.create({
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', margin: 0, padding: 0 },
  thumb: {
    all: 'unset',
    display: 'block',
    cursor: 'pointer',
    overflow: 'hidden',
    borderRadius: radiusVars['--radius-container'],
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colorVars['--color-accent'],
  },
  image: { display: 'block', width: 160, height: 120, objectFit: 'cover' },
})

/** The `Artifact` the shared preview renders for one tool image; `null` without a file id. */
function toArtifact(image: OAIOutputImagePart, index: number): Artifact | null {
  if (!image.file_id) return null
  return {
    id: image.file_id,
    name: image.filename ?? `Image ${index + 1}`,
    path: image.filename ?? `image-${index + 1}`,
    size: image.bytes,
    mime_type: image.media_type,
    session_id: '',
    updated_at: '',
    content_url: fileContentPath(image.file_id),
  }
}

export function ToolImages({ images }: { images: OAIOutputImagePart[] }) {
  const [selected, setSelected] = useState<Artifact | null>(null)
  const items = images.map(toArtifact).filter((artifact): artifact is Artifact => artifact !== null)
  if (items.length === 0) return null
  return (
    <>
      <ul {...stylex.props(styles.row)} aria-label="Images from this tool" data-testid="tool-images">
        {items.map((artifact) => (
          <li key={artifact.id}>
            <button type="button" aria-label={`Open ${artifact.name}`} onClick={() => setSelected(artifact)} {...stylex.props(styles.thumb)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- BFF bytes; next/image does not apply */}
              <img src={artifactUrl(artifact)} alt={artifact.name} loading="lazy" {...stylex.props(styles.image)} />
            </button>
          </li>
        ))}
      </ul>
      <ArtifactPreview artifact={selected} onClose={() => setSelected(null)} />
    </>
  )
}
