'use client'

/**
 * Attachments of the composer: `useAttachments` stages each added file through
 * `POST /agents/files` (progress per file, removal deletes the staged file),
 * and `AttachmentCards` shows them above the input, claude.ai style: a
 * thumbnail for an image, an icon for any other file, then name and size.
 */
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Text } from '@astryxdesign/core/Text'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import { DocumentIcon, XMarkIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import { formatBytes, isImageType, limitError, type UserFile } from '@/chat/attachments'

export interface Attachment {
  key: string
  name: string
  size: number
  mediaType: string
  /** Object URL of a local image, for the thumbnail. */
  previewUrl?: string
  /** Upload progress, `0..1`. */
  progress: number
  status: 'uploading' | 'done' | 'error'
  /** Staged file id once uploaded. */
  id?: string
  error?: string
  controller: AbortController
}

export interface Attachments {
  items: Attachment[]
  /** Why the last add was refused, or `null`. */
  error: string | null
  /** True while any upload is in flight. */
  uploading: boolean
  /** True when an upload failed (it blocks sending until removed). */
  failed: boolean
  add(files: File[]): void
  remove(key: string): void
  /** The staged files, for sending. */
  files(): UserFile[]
  /** Forgets the cards after a send (the files now belong to the message). */
  clear(): void
}

let counter = 0

export function useAttachments(): Attachments {
  const [items, setItems] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(items)
  latest.current = items

  const patch = useCallback((key: string, change: Partial<Attachment>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)))
  }, [])

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const refused = limitError(latest.current.length, files)
      setError(refused)
      if (refused) return
      const added = files.map((file): Attachment => {
        const key = `att_${++counter}`
        const controller = new AbortController()
        void api
          .uploadFile(file, (progress) => patch(key, { progress }), controller.signal)
          .then((staged) => patch(key, { status: 'done', progress: 1, id: staged.id, mediaType: staged.media_type, size: staged.bytes }))
          .catch((cause: unknown) => {
            if (controller.signal.aborted) return
            patch(key, { status: 'error', error: cause instanceof Error ? cause.message : 'Upload failed' })
          })
        return {
          key,
          name: file.name,
          size: file.size,
          mediaType: file.type,
          previewUrl: isImageType(file.type) ? URL.createObjectURL(file) : undefined,
          progress: 0,
          status: 'uploading',
          controller,
        }
      })
      setItems((current) => [...current, ...added])
    },
    [patch],
  )

  const remove = useCallback((key: string) => {
    const item = latest.current.find((candidate) => candidate.key === key)
    if (!item) return
    item.controller.abort()
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    // Best effort: a staged file that stays is removed by the backend's TTL sweeper.
    if (item.id) api.deleteFile(item.id).catch(() => {})
    setError(null)
    setItems((current) => current.filter((candidate) => candidate.key !== key))
  }, [])

  const clear = useCallback(() => {
    for (const item of latest.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    setItems([])
    setError(null)
  }, [])

  useEffect(
    () => () => {
      for (const item of latest.current) {
        item.controller.abort()
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
    },
    [],
  )

  return {
    items,
    error,
    uploading: items.some((item) => item.status === 'uploading'),
    failed: items.some((item) => item.status === 'error'),
    add,
    remove,
    files: () => items.flatMap((item) => (item.id ? [{ id: item.id, name: item.name, bytes: item.size, mediaType: item.mediaType }] : [])),
    clear,
  }
}

const styles = stylex.create({
  list: { display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', margin: 0, padding: 8 },
  card: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: 220,
    padding: 8,
    paddingInlineEnd: 32,
    boxSizing: 'border-box',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-container'],
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
  text: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  remove: { position: 'absolute', top: 2, insetInlineEnd: 2 },
})

function AttachmentCard({ item, onRemove }: { item: Attachment; onRemove(): void }) {
  return (
    <li {...stylex.props(styles.card)} data-testid="attachment-card" data-status={item.status}>
      <span {...stylex.props(styles.tile)}>
        {item.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL; next/image does not apply
          <img src={item.previewUrl} alt="" {...stylex.props(styles.thumb)} />
        ) : (
          <Icon icon={DocumentIcon} size="md" />
        )}
      </span>
      <span {...stylex.props(styles.text)}>
        <Text weight="medium" maxLines={1}>
          {item.name}
        </Text>
        {item.status === 'uploading' ? (
          <ProgressBar value={Math.round(item.progress * 100)} max={100} label={`Uploading ${item.name}`} isLabelHidden />
        ) : (
          <Text type="supporting" color="secondary" maxLines={1}>
            {item.status === 'error' ? (item.error ?? 'Upload failed') : formatBytes(item.size)}
          </Text>
        )}
      </span>
      <span {...stylex.props(styles.remove)}>
        <Button label={`Remove ${item.name}`} variant="ghost" size="sm" isIconOnly icon={<Icon icon={XMarkIcon} size="sm" />} onClick={onRemove} />
      </span>
    </li>
  )
}

/** The cards above the input; `null` without attachments. */
export function AttachmentCards({ attachments }: { attachments: Attachments }) {
  if (attachments.items.length === 0) return null
  return (
    <ul {...stylex.props(styles.list)} aria-label="Attachments">
      {attachments.items.map((item) => (
        <AttachmentCard key={item.key} item={item} onRemove={() => attachments.remove(item.key)} />
      ))}
    </ul>
  )
}
