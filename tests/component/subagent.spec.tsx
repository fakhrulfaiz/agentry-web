// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIApprovalAction, OAISubagent, OAITurn, StoredSessionItem } from '@/api/types'
import { applyItems, applySubagents, initialState, type MessageView } from '@/chat/reducer'
import { Message } from '@/ui/chat/Message'
import { formatDuration, MAX_SUBAGENT_DEPTH, SubagentActions, SubagentItems } from '@/ui/chat/SubagentCard'
import delegation from '../fixtures/live/subagent.json'

interface RecordedChild { subagent: OAISubagent; turns: OAITurn[]; items: StoredSessionItem[] }
const FIXTURE = delegation as unknown as { session_id: string; items: StoredSessionItem[]; subagents: RecordedChild[] }
const CHILD = FIXTURE.subagents[0]
const SID = FIXTURE.session_id
const itemsUrl = `/api/agentry/agents/sessions/${SID}/subagents/${CHILD.subagent.id}/items?limit=100`
const noAnswer = vi.fn(async () => {})
const fetchMock = vi.fn<typeof fetch>()

/** The card the reducer makes for the recorded child. */
function card(turns: OAITurn[] = CHILD.turns, subagent: OAISubagent = CHILD.subagent): Extract<MessageView, { kind: 'subagent' }> {
  const s = applySubagents(applyItems(initialState(SID), FIXTURE.items), [{ subagent, turns }])
  return s.items.find((v): v is Extract<MessageView, { kind: 'subagent' }> => v.kind === 'subagent')!
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) =>
    String(input) === itemsUrl
      ? Response.json({ object: 'list', data: CHILD.items, first_id: null, last_id: null, has_more: false })
      : Response.json({ error: 'not_found' }, { status: 404 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SubagentCard', () => {
  it('shows the model it ran in the header, and the prompt collapsed until opened', async () => {
    const user = userEvent.setup()
    const view = card(CHILD.turns, { ...CHILD.subagent, model: 'deepseek-flash' })
    expect(view.prompt).toMatch(/^Your task: list the files/)
    render(<Message view={view} answer={noAnswer} />)
    const header = screen.getByRole('button', { name: /List workspace files and count/ })
    expect(within(header).getByTestId('subagent-model')).toHaveTextContent('deepseek-flash')
    await user.click(header)
    const prompt = screen.getByRole('button', { name: 'Prompt' })
    expect(prompt).toHaveAttribute('aria-expanded', 'false')
    await user.click(prompt)
    expect(prompt).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByTestId('subagent-prompt')).getByText(/Your task: list the files/)).toBeVisible()
  })

  it('shows an approval the subagent waits on inside its card, collapsed or not, and answers it through the conversation', async () => {
    const user = userEvent.setup()
    const answer = vi.fn(async () => {})
    const action: OAIApprovalAction = { type: 'approval', id: 'appr-c', kind: 'tool_approval', prompt: 'Run ls -la', options: ['approve', 'deny'], tool_name: 'bash', subagent_id: CHILD.subagent.id }
    render(
      <SubagentActions.Provider value={new Map([[CHILD.subagent.id, [action]]])}>
        <Message view={card()} answer={answer} />
      </SubagentActions.Provider>,
    )
    const inCard = within(screen.getByTestId('subagent-card'))
    expect(inCard.getByRole('group', { name: 'Approval needed' })).toHaveTextContent('Run ls -la')
    await user.click(inCard.getByRole('button', { name: 'Allow' }))
    expect(answer).toHaveBeenCalledWith('appr-c', { decision: 'approve' })
  })

  it('collapsed: shows the name, status and duration without loading the child', () => {
    render(<Message view={card()} answer={noAnswer} />)
    const header = screen.getByRole('button', { name: /List workspace files and count/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header).toHaveTextContent('Done')
    expect(header).toHaveTextContent(formatDuration(CHILD.turns[0].completed_at! - CHILD.turns[0].started_at!))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('running: says it is working', () => {
    render(<Message view={card([{ ...CHILD.turns[0], status: 'in_progress', completed_at: null }])} answer={noAnswer} />)
    expect(screen.getByRole('button', { name: /List workspace files and count/ })).toHaveTextContent('Working')
  })

  it('expanded: loads the child items and renders them with the same message, thinking and tool views', async () => {
    const user = userEvent.setup()
    render(<Message view={card()} answer={noAnswer} />)
    await user.click(screen.getByRole('button', { name: /List workspace files and count/ }))
    expect(fetchMock).toHaveBeenCalledWith(itemsUrl, expect.objectContaining({ method: 'GET' }))
    const activity = await screen.findByTestId('subagent-activity')
    expect(await within(activity).findAllByRole('button', { name: /glob/ })).not.toHaveLength(0)
    expect(within(activity).getAllByRole('button', { name: /command/ })).toHaveLength(2)
    expect(within(activity).getAllByRole('button', { name: /^Thought/ }).length).toBeGreaterThan(0)
    expect(within(activity).getAllByTestId('assistant-message').at(-1)).toHaveTextContent(/couldn.t complete the requested commands/)
    // The child's prompt shows as the user message it received.
    expect(within(activity).getByText(/Your task: list the files/)).toBeInTheDocument()
  })

  it('expanded inside a conversation: shows the items the conversation read, and never polls by itself', async () => {
    vi.useFakeTimers()
    try {
      const running = card([{ ...CHILD.turns[0], status: 'in_progress', completed_at: null }])
      const shared = new Map([[CHILD.subagent.id, CHILD.items.slice(0, 2)]])
      const { rerender } = render(
        <SubagentItems.Provider value={shared}>
          <Message view={running} answer={noAnswer} />
        </SubagentItems.Provider>,
      )
      fireEvent.click(screen.getByRole('button', { name: /List workspace files and count/ }))
      expect(within(screen.getByTestId('subagent-activity')).getByText(/Your task: list the files/)).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(fetchMock).not.toHaveBeenCalled()
      // The conversation's next read shows up in the open card.
      rerender(
        <SubagentItems.Provider value={new Map([[CHILD.subagent.id, CHILD.items]])}>
          <Message view={running} answer={noAnswer} />
        </SubagentItems.Provider>,
      )
      expect(within(screen.getByTestId('subagent-activity')).getAllByTestId('assistant-message').at(-1)).toHaveTextContent(/couldn.t complete the requested commands/)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it(`stops nesting at depth ${MAX_SUBAGENT_DEPTH}: the card there cannot expand`, () => {
    render(<Message view={card()} answer={noAnswer} depth={MAX_SUBAGENT_DEPTH} />)
    expect(screen.getByText('List workspace files and count')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /List workspace files and count/ })).toBeNull()
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(17)).toBe('17s')
    expect(formatDuration(125)).toBe('2m 5s')
  })
})
