// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAISubagent, OAITurn, StoredSessionItem } from '@/api/types'
import { applyItems, applySubagents, initialState, type MessageView } from '@/chat/reducer'
import { Message } from '@/ui/chat/Message'
import { formatDuration, MAX_SUBAGENT_DEPTH } from '@/ui/chat/SubagentCard'
import delegation from '../fixtures/live/subagent.json'

interface RecordedChild { subagent: OAISubagent; turns: OAITurn[]; items: StoredSessionItem[] }
const FIXTURE = delegation as unknown as { session_id: string; items: StoredSessionItem[]; subagents: RecordedChild[] }
const CHILD = FIXTURE.subagents[0]
const SID = FIXTURE.session_id
const itemsUrl = `/api/agentry/agents/sessions/${SID}/subagents/${CHILD.subagent.id}/items?limit=100`
const noAnswer = vi.fn(async () => {})
const fetchMock = vi.fn<typeof fetch>()

/** The card the reducer makes for the recorded child. */
function card(turns: OAITurn[] = CHILD.turns): Extract<MessageView, { kind: 'subagent' }> {
  const s = applySubagents(applyItems(initialState(SID), FIXTURE.items), [{ subagent: CHILD.subagent, turns }])
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
