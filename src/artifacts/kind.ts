/**
 * Classifying artifacts for the Artifacts page: the file-type group that picks
 * an icon and tint, how an artifact can be previewed, and where its bytes are
 * served from the browser. Client-safe: the BFF's artifact bytes route reuses
 * the extension→MIME table.
 */
import type { Artifact } from '@/api/types'

export type ArtifactKind = 'doc' | 'slides' | 'sheet' | 'pdf' | 'code' | 'other'
export type PreviewMode = 'image' | 'pdf' | 'text' | 'none'

const extension = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

/** MIME type per file name, for artifacts the backend serves as opaque bytes. */
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  sh: 'text/x-shellscript; charset=utf-8',
  html: 'text/plain; charset=utf-8',
  css: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  zip: 'application/zip',
}

/** MIME the BFF answers with; the upstream always sends `application/octet-stream`. */
export function contentTypeForName(name: string): string {
  return CONTENT_TYPES[extension(name)] ?? 'application/octet-stream'
}

/**
 * Whether a workspace listing entry is a file worth showing the user. The
 * backend enumerates the whole session workspace, including the agent's tooling
 * — Python dependencies installed into the workspace (`.pylibs`, `.venv`), C
 * caches and builds (`__pycache__`), other dot directories and dot files. Those
 * were never servable (the bytes route refuses dot-files), so the Artifacts
 * page and the chat file strip hide them instead of drowning the two files the
 * turn actually made.
 */
export function isPresentedArtifact(path: string): boolean {
  return !path
    .split('/')
    .some((segment) => segment.startsWith('.') || segment === '__pycache__')
}

const CODE_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh',
  'html', 'css', 'sql', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'rb', 'toml',
])

/** True for MIME types whose bytes are readable text. */
const isTextMime = (mime: string): boolean =>
  mime.startsWith('text/') || /(json|xml|yaml|javascript|x-sh)$/.test(mime)

export function artifactKind(artifact: Pick<Artifact, 'name' | 'mime_type'>): ArtifactKind {
  const mime = artifact.mime_type.toLowerCase()
  const ext = extension(artifact.name)
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime.includes('wordprocessingml') || mime === 'application/msword' || ext === 'doc' || ext === 'docx') return 'doc'
  if (mime.includes('presentationml') || mime.includes('powerpoint') || ext === 'ppt' || ext === 'pptx') return 'slides'
  if (mime.includes('spreadsheetml') || mime.includes('ms-excel') || ext === 'xls' || ext === 'xlsx') return 'sheet'
  if (isTextMime(mime) || CODE_EXTENSIONS.has(ext)) return 'code'
  return 'other'
}

export function previewMode(artifact: Pick<Artifact, 'name' | 'mime_type'>): PreviewMode {
  if (artifact.mime_type.toLowerCase().startsWith('image/')) return 'image'
  const kind = artifactKind(artifact)
  if (kind === 'pdf') return 'pdf'
  return kind === 'code' ? 'text' : 'none'
}

/** Browser URL of an artifact's bytes through the BFF; `download` asks for an attachment. */
export function artifactUrl(artifact: Pick<Artifact, 'content_url'>, download = false): string {
  const path = `/api/agentry${artifact.content_url.replace(/^\/v1/, '')}`
  return download ? `${path}?download=1` : path
}
