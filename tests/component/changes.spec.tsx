// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { ChangesCard } from '@/ui/chat/ChangesCard'
import { DiffView } from '@/ui/preview/ChangesPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const routes = (table: Record<string, () => Response>) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const hit = table[String(url)]
    return hit ? hit() : Response.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 })
  }))

function ActiveTab() {
  const { state } = usePreviewPanel()
  return <output data-testid="active">{state.active}|{state.views.map((v) => v.title).join(',')}</output>
}

describe('ChangesCard', () => {
  it('is hidden when nothing was recorded', async () => {
    routes({ '/api/agentry/agents/sessions/s1/turns/turn_1/changes': () => Response.json({ object: 'agent.session.turn.changes', turn_id: 'turn_1', available: false, total: 0, added: 0, deleted: 0, outside: 0, files: [] }) })
    const { container } = render(<ChangesCard sessionId="s1" turnId="turn_1" completed />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="changes-card"]')).toBeNull()
  })

  it('does not load before the turn completes', () => {
    routes({})
    render(<ChangesCard sessionId="s1" turnId="turn_1" completed={false} />)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows counts and opens a diff tab', async () => {
    routes({ '/api/agentry/agents/sessions/s1/turns/turn_1/changes': () => Response.json({
      object: 'agent.session.turn.changes', turn_id: 'turn_1', available: true, total: 2, added: 42, deleted: 7, outside: 1,
      files: [{ index: 1, path: 'src/app.ts', display: 'src/app.ts', added: 40, deleted: 7 }, { index: 2, path: 'logo.png', display: 'logo.png', added: 0, deleted: 0, binary: true }],
    }) })
    render(<PreviewPanelProvider sessionId="s1"><ChangesCard sessionId="s1" turnId="turn_1" completed defaultOpen /><ActiveTab /></PreviewPanelProvider>)
    await screen.findByText('2 files changed and 1 outside the workspace')
    expect(screen.getByText('+42')).toBeInTheDocument()
    expect(screen.getAllByText('−7')).toHaveLength(2)
    expect(screen.getByText('Binary')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show changes in src/app.ts' }))
    expect(screen.getByTestId('active')).toHaveTextContent('view:diff:turn_1:1|app.ts (changes)')
  })
})

describe('DiffView', () => {
  it('renders added, deleted and context rows with a gap', async () => {
    routes({ '/api/agentry/agents/sessions/s1/turns/turn_1/changes/1': () => Response.json({
      object: 'agent.session.turn.change', kind: 'text', path: 'src/app.ts', display: 'src/app.ts', before: true, after: true, coarse: false,
      hunks: [
        { old_start: 1, old_lines: 2, new_start: 1, new_lines: 2, lines: [' keep', '-old', '+new'] },
        { old_start: 20, old_lines: 1, new_start: 20, new_lines: 1, lines: [' tail'] },
      ],
    }) })
    const { container } = render(<DiffView sessionId="s1" turnId="turn_1" index={1} />)
    await screen.findByText('new')
    expect(container.querySelectorAll('tr[data-kind="add"]')).toHaveLength(1)
    expect(container.querySelectorAll('tr[data-kind="del"]')).toHaveLength(1)
    expect(container.querySelectorAll('tr[data-kind="context"]')).toHaveLength(2)
    expect(screen.getByText('⋯ 17 unchanged lines')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open file' })).toBeInTheDocument()
  })

  it('says the changes are gone on 404', async () => {
    routes({})
    render(<DiffView sessionId="s1" turnId="turn_1" index={4} />)
    await screen.findByText('These changes are no longer available.')
  })
})
