// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OAIApprovalAction, OAISubagent, OAITurn, StoredSessionItem } from '@/api/types'
import { PanelConversationContext, type PanelConversation } from '@/chat/panel-data'
import { EMPTY_BROWSER } from '@/chat/browser-tools'
import { applyItems, applySubagents, initialState, type MessageView } from '@/chat/reducer'
import { deriveTasks } from '@/chat/tasks'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { Message } from '@/ui/chat/Message'
import { PreviewPanel } from '@/ui/preview/PreviewPanel'
import delegation from '../fixtures/live/subagent.json'

vi.mock('@/api/client', () => ({ api: { listSessionArtifacts: vi.fn(async () => ({ object: 'list', data: [] })) } }))

interface RecordedChild { subagent: OAISubagent; turns: OAITurn[]; items: StoredSessionItem[] }
const FIXTURE = delegation as unknown as { session_id: string; items: StoredSessionItem[]; subagents: RecordedChild[] }
const CHILD = FIXTURE.subagents[0]
const SID = FIXTURE.session_id

const state = applySubagents(applyItems(initialState(SID), FIXTURE.items), [{ subagent: CHILD.subagent, turns: CHILD.turns, items: CHILD.items }])
const subView = state.items.find((v): v is Extract<MessageView, { kind: 'subagent' }> => v.kind === 'subagent')!
const approval: OAIApprovalAction = { type: 'approval', id: 'appr-c', kind: 'tool_approval', prompt: 'Run ls -la', options: ['approve', 'deny'], tool_name: 'bash', subagent_id: CHILD.subagent.id }

function data(over: Partial<PanelConversation> = {}): PanelConversation {
  const actions = new Map([[CHILD.subagent.id, [approval]]])
  return {
    tasks: deriveTasks(state.items, state.subagents, actions),
    subagentViews: [subView],
    todos: [],
    browser: EMPTY_BROWSER,
    items: new Map([[CHILD.subagent.id, CHILD.items]]),
    actions,
    answer: vi.fn(async () => {}),
    ...over,
  }
}

let controls: ReturnType<typeof usePreviewPanel>['actions'] | null = null
function Controls() {
  controls = usePreviewPanel().actions
  return null
}
const mount = (value: PanelConversation) =>
  render(
    <PreviewPanelProvider sessionId="s1">
      <PanelConversationContext.Provider value={value}>
        <Controls />
        <PreviewPanel sessionId="s1" idle />
      </PanelConversationContext.Provider>
    </PreviewPanelProvider>,
  )

afterEach(cleanup)

describe('Tasks tab', () => {
  it('lists the subagents with status and a waiting badge, and opens one as a tab with its transcript and approval', async () => {
    const value = data()
    mount(value)
    act(() => controls!.showStart())
    await userEvent.click(await screen.findByRole('button', { name: /^Tasks/ }))
    const row = await screen.findByRole('button', { name: `Open ${subView.name}` })
    expect(within(row).getByText('Approval needed')).toBeInTheDocument()
    expect(within(row).getByText(/Done|Closed|Running|Failed/)).toBeInTheDocument()
    await userEvent.click(row)
    const tab = await screen.findByTestId('subagent-tab')
    expect(within(tab).getByRole('button', { name: 'Prompt' })).toBeInTheDocument()
    await userEvent.click(within(tab).getByRole('button', { name: 'Allow' }))
    expect(value.answer).toHaveBeenCalledWith('appr-c', { decision: 'approve' })
    expect(screen.getByRole('tab', { name: subView.name })).toHaveAttribute('aria-selected', 'true')
  })

  it('has an empty state without subagents', async () => {
    mount(data({ tasks: [], subagentViews: [] }))
    act(() => controls!.openView('tasks', 'Tasks'))
    expect(await screen.findByText('No background tasks')).toBeInTheDocument()
  })
})

describe('Plan tab', () => {
  it('shows the to-do list with progress on the Start entry', async () => {
    mount(data({ todos: [{ content: 'Write tests', status: 'completed' }, { content: 'Ship it', status: 'in_progress' }] }))
    act(() => controls!.showStart())
    const entry = await screen.findByRole('button', { name: /^Plan/ })
    expect(entry).toHaveTextContent('1/2 done')
    await userEvent.click(entry)
    const list = await screen.findByTestId('plan-list')
    expect(within(list).getByText('Write tests')).toBeInTheDocument()
    expect(list.querySelector('[data-status="in_progress"]')).toHaveTextContent('Ship it')
  })

  it('shows an empty state when there are no to-dos', async () => {
    mount(data())
    act(() => controls!.openView('plan', 'Plan'))
    expect(await screen.findByText('No plan yet')).toBeInTheDocument()
  })
})

describe('Open in panel', () => {
  it('opens the subagent from its inline card', async () => {
    render(
      <PreviewPanelProvider sessionId="s1">
        <Controls />
        <PanelConversationContext.Provider value={data()}>
          <Message view={subView} answer={vi.fn(async () => {})} />
          <PreviewPanel sessionId="s1" idle />
        </PanelConversationContext.Provider>
      </PreviewPanelProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open in panel' }))
    expect(await screen.findByTestId('subagent-tab')).toBeInTheDocument()
  })
})
