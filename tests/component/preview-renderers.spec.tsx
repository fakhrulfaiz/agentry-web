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
