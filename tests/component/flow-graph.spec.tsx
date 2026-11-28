// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelConversation } from '@/chat/panel-data'
import { PanelConversationContext } from '@/chat/panel-data'
import type { TaskRow } from '@/chat/tasks'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { HelpersButton } from '@/ui/chat/HelpersButton'
import { FlowGraph } from '@/ui/shared/FlowGraph'

afterEach(cleanup)

describe('FlowGraph', () => {
  it('shows the root and nodes with meta, and a click selects', async () => {
    const onSelect = vi.fn()
    render(<FlowGraph root={{ title: 'Delegator', subtitle: 'this chat' }} nodes={[{ id: 'a', title: 'Echo helper', status: 'done', meta: ['12s', '3.1k tokens'], onSelect }]} />)
    expect(screen.getByText('Delegator')).toBeInTheDocument()
    expect(screen.getByText('Done · 12s · 3.1k tokens')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open Echo helper' }))
    expect(onSelect).toHaveBeenCalled()
  })
})

const task = (over: Partial<TaskRow>): TaskRow => ({ id: 't', name: 'Echo', status: 'running', waiting: 0, ...over })
const data = (tasks: TaskRow[]): PanelConversation => ({ tasks, jobs: [], subagentViews: [], todos: [], browser: undefined as never, items: new Map(), actions: new Map(), answer: async () => {} })

function Active() {
  const { state } = usePreviewPanel()
  return <p data-testid="active">{state.open ? state.active : 'closed'}</p>
}
const setup = (tasks: TaskRow[]) =>
  render(
    <PreviewPanelProvider sessionId="s">
      <PanelConversationContext.Provider value={data(tasks)}>
        <HelpersButton />
        <Active />
      </PanelConversationContext.Provider>
    </PreviewPanelProvider>,
  )

describe('HelpersButton', () => {
  it('is hidden without helpers', () => {
    setup([])
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('shows the running count and opens the Tasks tab', async () => {
    setup([task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c', status: 'done' })])
    expect(screen.getByTestId('helpers-dot')).toHaveAttribute('data-state', 'running')
    await userEvent.click(screen.getByRole('button', { name: 'Helpers: 2 running' }))
    expect(screen.getByTestId('active')).toHaveTextContent('view:tasks')
  })
  it('turns amber when a helper needs you', () => {
    setup([task({ id: 'a' }), task({ id: 'b', waiting: 1 })])
    expect(screen.getByTestId('helpers-dot')).toHaveAttribute('data-state', 'needs')
    expect(screen.getByRole('button', { name: 'Helpers: 1 needs you' })).toBeInTheDocument()
  })
})
