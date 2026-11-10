/**
 * Attachment helpers shared by the composer and the message list: the upload
 * limits Agentry enforces (checked here first for a short error), and the
 * mapping of a file on a user message to the `Artifact` the preview shows.
 */
import type { Artifact } from '@/api/types'

/** Per-file and per-message limits of the backend's default `uploads` config. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_FILES = 10

/** A file on a user message: staged by this app, or echoed by the backend. */
export interface UserFile {
  /** Absent when the file was not uploaded through the API; it then has no content link. */
  id?: string
  name: string
  bytes?: number
  mediaType?: string
}

/** `1.4 MB`, `820 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
}

export const isImageType = (mediaType: string | undefined): boolean => (mediaType ?? '').toLowerCase().startsWith('image/')

/** The first limit that `incoming` breaks on top of `existing` files already staged, or `null`. */
export function limitError(existing: number, incoming: readonly Pick<File, 'name' | 'size'>[]): string | null {
  if (existing + incoming.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files per message.`
  const big = incoming.find((file) => file.size > MAX_FILE_BYTES)
  if (big) return `${big.name} is over ${formatBytes(MAX_FILE_BYTES)}.`
  const empty = incoming.find((file) => file.size === 0)
  return empty ? `${empty.name} is empty.` : null
}

/** BFF path of a file's bytes. */
export function fileContentPath(id: string): string {
  return `/v1/agents/files/${encodeURIComponent(id)}/content`
}

/** The `Artifact` the shared preview and card render for a message file; `null` without a content link. */
export function fileToArtifact(file: UserFile, sessionId = ''): Artifact | null {
  if (!file.id) return null
  return {
    id: file.id,
    name: file.name,
    path: file.name,
    size: file.bytes ?? 0,
    mime_type: file.mediaType ?? 'application/octet-stream',
    session_id: sessionId,
    updated_at: '',
    content_url: fileContentPath(file.id),
  }
}
