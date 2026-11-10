'use client'

/**
 * The files of a user message: images as thumbnails (click opens the preview
 * dialog), any other file as the same card the chat's file strip uses. A file
 * without an id (not uploaded through the API) has no content link and shows
 * as a plain name and size.
 */
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { Artifact } from '@/api/types'
import { artifactUrl } from '@/artifacts/kind'
import { fileToArtifact, formatBytes, isImageType, type UserFile } from '@/chat/attachments'
import { ArtifactPreview } from '@/ui/artifacts/ArtifactPreview'
import { FileCard } from './SessionArtifacts'

const styles = stylex.create({
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', margin: 0, padding: 0 },
  cards: { display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr)', width: 280, listStyle: 'none', margin: 0, padding: 0 },
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
  image: { display: 'block', width: 120, height: 120, objectFit: 'cover' },
})

export function MessageFiles({ files }: { files: UserFile[] }) {
  const [selected, setSelected] = useState<Artifact | null>(null)
  const items = files.map((file) => ({ file, artifact: fileToArtifact(file) }))
  const images = items.filter((item) => item.artifact && isImageType(item.file.mediaType))
  const others = items.filter((item) => !images.includes(item))
  return (
    <>
      {images.length > 0 && (
        <ul {...stylex.props(styles.row)} aria-label="Attached images" data-testid="message-images">
          {images.map(({ file, artifact }) => (
            <li key={artifact!.id}>
              <button type="button" aria-label={`Preview ${file.name}`} onClick={() => setSelected(artifact)} {...stylex.props(styles.thumb)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- BFF bytes; next/image does not apply */}
                <img src={artifactUrl(artifact!)} alt={file.name} loading="lazy" {...stylex.props(styles.image)} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul {...stylex.props(styles.cards)} aria-label="Attached files" data-testid="message-files">
          {others.map(({ file, artifact }) =>
            artifact ? (
              <FileCard key={artifact.id} artifact={artifact} onOpen={() => setSelected(artifact)} />
            ) : (
              <li key={file.name}>
                <Text maxLines={1}>{file.bytes != null ? `${file.name} · ${formatBytes(file.bytes)}` : file.name}</Text>
              </li>
            ),
          )}
        </ul>
      )}
      <ArtifactPreview artifact={selected} onClose={() => setSelected(null)} />
    </>
  )
}
