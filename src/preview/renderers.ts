/** Which preview renderers a file offers, by extension. Client-safe and pure. */
import { CODE_EXTENSIONS } from '@/artifacts/kind'

export type RendererId = 'markdown' | 'code' | 'text' | 'image' | 'video' | 'pdf' | 'html' | 'source' | 'table' | 'json' | 'docx' | 'officePdf' | 'sheet' | 'download'

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
const VIDEOS = new Set(['webm', 'mp4'])

export function renderersFor(name: string): { default: RendererId; options: RendererId[] } {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  const pick = (...options: RendererId[]) => ({ default: options[0], options })
  if (ext === 'md' || ext === 'markdown') return pick('markdown', 'code', 'text')
  if (ext === 'html' || ext === 'htm') return pick('html', 'source')
  if (ext === 'svg') return pick('image', 'source')
  if (IMAGES.has(ext)) return pick('image')
  if (ext === 'pdf') return pick('pdf')
  if (VIDEOS.has(ext)) return pick('video', 'download')
  // Word opens as PDF pages (exact layout) with the in-browser conversion as "Text"; spreadsheets open as a readable sheet.
  if (ext === 'docx') return pick('officePdf', 'docx')
  if (ext === 'doc' || ext === 'ppt' || ext === 'pptx') return pick('officePdf')
  if (ext === 'xls' || ext === 'xlsx') return pick('sheet', 'officePdf', 'download')
  if (ext === 'csv' || ext === 'tsv') return pick('table', 'text')
  if (ext === 'json') return pick('json', 'code')
  if (CODE_EXTENSIONS.has(ext)) return pick('code', 'text')
  return pick('download')
}
