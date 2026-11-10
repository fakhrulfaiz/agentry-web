import { describe, expect, it } from 'vitest'
import { artifactContentType, artifactDisposition, sanitizeArtifactSegments } from '@/server/artifact-bytes'

describe('sanitizeArtifactSegments', () => {
  it('joins the decoded catch-all segments of a workspace file', () => {
    expect(sanitizeArtifactSegments(['report.docx'])).toBe('report.docx')
    expect(sanitizeArtifactSegments(['sub', 'folder notes.v2.md'])).toBe('sub/folder notes.v2.md')
  })

  it('rejects escapes, empty and control segments', () => {
    for (const segments of [
      [],
      ['..'],
      ['a', '..', 'b'],
      ['a/b'],
      ['a\\b'],
      [''],
      ['.hidden'],
      ['a\u0000b'],
    ]) {
      expect(sanitizeArtifactSegments(segments as string[]), String(segments)).toBeUndefined()
    }
  })
})

describe('artifactContentType', () => {
  it('maps the previewable and known extensions', () => {
    expect(artifactContentType('photo.png')).toBe('image/png')
    expect(artifactContentType('pic.jpg')).toBe('image/jpeg')
    expect(artifactContentType('brief.pdf')).toBe('application/pdf')
    expect(artifactContentType('notes.md')).toContain('text/plain')
    expect(artifactContentType('data.json')).toBe('application/json')
    expect(artifactContentType('table.csv')).toContain('text/csv')
    expect(artifactContentType('make_doc.py')).toContain('text/x-python')
    expect(artifactContentType('report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(artifactContentType('unknown.blob')).toBe('application/octet-stream')
    expect(artifactContentType('no-extension')).toBe('application/octet-stream')
  })
})

describe('artifactDisposition', () => {
  it('offers a download with the file name preserved', () => {
    expect(artifactDisposition('report.docx', true)).toContain("attachment; filename=\"report.docx\"")
    expect(artifactDisposition('report.next version.docx', false)).toContain('attachment')
  })

  it('serves preview-safe types inline unless download is forced', () => {
    expect(artifactDisposition('photo.png', false)).toContain('inline')
    expect(artifactDisposition('brief.pdf', false)).toContain('inline')
    expect(artifactDisposition('notes.md', false)).toContain('inline')
    expect(artifactDisposition('photo.png', true)).toContain('attachment')
    expect(artifactDisposition('report.docx', false)).toContain('attachment')
  })
})
