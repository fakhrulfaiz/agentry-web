/**
 * Server-side plumbing for an artifact's bytes: validating the decoded
 * catch-all segments against path escapes, and deriving the inline
 * `Content-Type` / `Content-Disposition` the browser needs (the upstream
 * always answers `application/octet-stream`).
 */
import { contentTypeForName } from '@/artifacts/kind'

/** One path segment of a file under a session's workspace. */
const FILE_SEGMENT = /^[A-Za-z0-9 _.,()+[\]-]+$/

export { contentTypeForName as artifactContentType }

/** Types the browser may show in place; everything else downloads. nosniff keeps the text types inert. */
const INLINE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'video/webm',
  'video/mp4',
  'text/plain; charset=utf-8',
  'text/csv; charset=utf-8',
])

export function artifactDisposition(name: string, download: boolean): string {
  const inline = INLINE.has(contentTypeForName(name))
  const kind = inline && !download ? 'inline' : 'attachment'
  // A plain `filename` can hold any workspace byte-safe name this route accepts.
  const safe = name.replace(/["\\\r\n]/g, ' ')
  return `${kind}; filename="${safe}"`
}

/** The relative workspace path of decoded catch-all segments, or `undefined` when anything escapes. */
export function sanitizeArtifactSegments(segments: readonly string[]): string | undefined {
  if (segments.length === 0) return undefined
  const safe = segments.map((segment) => segment.trim())
  if (safe.some((segment) => segment.startsWith('.') || !FILE_SEGMENT.test(segment))) {
    return undefined
  }
  return safe.join('/')
}
