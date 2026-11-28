import { describe, expect, it } from 'vitest'
import { renderersFor } from '@/preview/renderers'

describe('renderersFor', () => {
  it.each([
    ['a.md', 'markdown', ['markdown', 'code', 'text']],
    ['a.html', 'html', ['html', 'source']],
    ['a.png', 'image', ['image']],
    ['a.csv', 'table', ['table', 'text']],
    ['a.json', 'json', ['json', 'code']],
    ['a.py', 'code', ['code', 'text']],
    ['a.docx', 'officePdf', ['officePdf', 'docx']],
    ['a.DOC', 'officePdf', ['officePdf']],
    ['a.pptx', 'officePdf', ['officePdf']],
    ['a.ppt', 'officePdf', ['officePdf']],
    ['a.xlsx', 'sheet', ['sheet', 'officePdf', 'download']],
    ['a.xls', 'sheet', ['sheet', 'officePdf', 'download']],
    ['a.bin', 'download', ['download']],
    ['a.PDF', 'pdf', ['pdf']],
    ['recordings/demo.webm', 'video', ['video', 'download']],
    ['clip.MP4', 'video', ['video', 'download']],
  ])('%s', (name, def, options) => {
    expect(renderersFor(name)).toEqual({ default: def, options })
  })
})
