// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RendererBody } from '@/ui/preview/renderers'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base = { sessionId: 's1', path: 'a.html', reloadKey: 0, wrap: true, runScripts: false }
const stub = (status: number, body = '') => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))

describe('RendererBody', () => {
  it('sandboxes HTML with no allow-same-origin; Run scripts adds only allow-scripts', async () => {
    stub(200, '<script>alert(1)</script>')
    const { container, rerender } = render(<RendererBody {...base} id="html" />)
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('')
    rerender(<RendererBody {...base} id="html" runScripts />)
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts')
  })
  it('renders CSV rows and reports a missing file', async () => {
    stub(200, 'a,b\n1,2\n3,4\n')
    const { container } = render(<RendererBody {...base} path="t.csv" id="table" />)
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2))
    cleanup()
    stub(404)
    const onMissing = vi.fn()
    render(<RendererBody {...base} path="gone.md" id="markdown" onMissing={onMissing} />)
    await screen.findByText('File no longer exists.')
    expect(onMissing).toHaveBeenCalled()
  })
})

describe('RendererBody docx', () => {
  it('reports a missing document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    render(<RendererBody sessionId="s1" path="a.docx" reloadKey={0} wrap runScripts={false} id="docx" />)
    await screen.findByText('File no longer exists.')
  })
})

describe('RendererBody officePdf', () => {
  const office = { sessionId: 's1', path: 'deck.pptx', reloadKey: 0, wrap: true, runScripts: false, id: 'officePdf' as const }
  it('shows the rendered PDF from a blob URL, fetched with no-cache so the etag is used', async () => {
    const fetchMock = vi.fn(async () => new Response('%PDF-1.7', { status: 200, headers: { 'x-agentry-missing-fonts': 'Calibri,Noto%20Sans' } }))
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:pdf-1')
    URL.revokeObjectURL = vi.fn()
    const { container } = render(<RendererBody {...office} />)
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-1'))
    expect(fetchMock).toHaveBeenCalledWith('/api/agentry/agents/sessions/s1/renders/pdf/deck.pptx', expect.objectContaining({ cache: 'no-cache' }))
    expect(screen.getByText('Some fonts are not installed; the layout may differ.')).toBeInTheDocument()
  })
  it('explains a document that cannot be read and offers Download', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'invalid_document' } }, { status: 422 })))
    render(<RendererBody {...office} />)
    await screen.findByText('This file could not be read as a document.')
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/agentry/agents/sessions/s1/artifacts/deck.pptx?download=1')
  })
})
