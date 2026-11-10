import { describe, expect, it } from 'vitest'
import { isPresentedArtifact } from '@/artifacts/kind'

describe('isPresentedArtifact', () => {
  it('shows the files a turn creates', () => {
    expect(isPresentedArtifact('artificial-intelligence.docx')).toBe(true)
    expect(isPresentedArtifact('make_docx.py')).toBe(true)
    expect(isPresentedArtifact('outputs/report.pdf')).toBe(true)
  })

  it('hides dependency and cache trees the agent installs into the workspace', () => {
    // python-docx landed in .pylibs because this config had no venv module.
    expect(isPresentedArtifact('.pylibs/docx/document.py')).toBe(false)
    expect(isPresentedArtifact('.pylibs/__pycache__/__init__.cpython-312.pyc')).toBe(false)
    expect(isPresentedArtifact('.venv/bin/python')).toBe(false)
    expect(isPresentedArtifact('outputs/.env')).toBe(false)
    // __pycache__ can also nest under a visible directory.
    expect(isPresentedArtifact('outputs/__pycache__/build.pyc')).toBe(false)
  })
})

describe('isPresentedArtifact uploads', () => {
  it('hides the user attachments under the top-level uploads folder only', () => {
    expect(isPresentedArtifact('uploads/report.docx')).toBe(false)
    expect(isPresentedArtifact('outputs/uploads/report.docx')).toBe(true)
    expect(isPresentedArtifact('uploads')).toBe(true)
  })
})
