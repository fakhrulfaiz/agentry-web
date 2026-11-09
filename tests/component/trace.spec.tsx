// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OAITurn, StoredSessionItem } from '@/api/types'
import { applyItems, applyTurns, initialState } from '@/chat/reducer'
import { Message } from '@/ui/chat/Message'
import { buildTrace } from '@/ui/trace/build-trace'
import { TracePanel } from '@/ui/trace/TracePanel'
import live from '../fixtures/live/web-search.json'

const ITEMS = live.items as StoredSessionItem[]
const TURNS = live.turns as OAITurn[]
const noAnswer = vi.fn(async () => {})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The conversation rows and the trace, both from the same reducer state. */
function renderBoth(turns: OAITurn[] = TURNS) {
  const state = applyTurns(applyItems(initialState(live.session_id), ITEMS), turns)
  return render(
    <>
      {state.items.map((view) => (
        <Message key={view.id} view={view} answer={noAnswer} />
      ))}
      <TracePanel turns={buildTrace(state.turns, state.log)} />
    </>,
  )
}

describe('TracePanel', () => {
  it('shows each turn with its status, duration and steps', () => {
    renderBoth()
    const turn = screen.getByRole('region', { name: 'Turn 1' })
    expect(within(turn).getByText('Done')).toBeInTheDocument()
    expect(within(turn).getByText('13s')).toBeInTheDocument()
    const steps = within(turn).getAllByTestId('trace-step')
    expect(steps).toHaveLength(7)
    expect(within(turn).getByText('web_search')).toBeInTheDocument()
    expect(within(turn).getByText('web_fetch')).toBeInTheDocument()
  })

  it('shows the token usage when the turn record has it', () => {
    const usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 0 }, output_tokens: 340, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1540 }
    renderBoth([{ ...TURNS[0], usage }])
    expect(screen.getByText('1,540 tokens · 1,200 in · 340 out')).toBeInTheDocument()
  })

  it('clicking a step scrolls the conversation to that item', async () => {
    const user = userEvent.setup()
    const scrolled: Element[] = []
    // jsdom has no scrolling: stub it.
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this)
    })
    renderBoth()
    const trace = screen.getByRole('region', { name: 'Turn 1' })
    await user.click(within(trace).getByRole('button', { name: /web_fetch/ }))
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]).toHaveAttribute('data-item-id', 'item_fn_27')
    expect(scrolled[0]).toHaveTextContent('web_fetch')

    await user.click(within(trace).getByRole('button', { name: /The latest stable Node\.js release/ }))
    expect(scrolled[1]).toHaveAttribute('data-item-id', 'item_msg_32')
    expect(scrolled[1]).toHaveTextContent('v26.13.0')
  })

  it('says so when there are no turns yet', () => {
    render(<TracePanel turns={[]} />)
    expect(screen.getByText('No turns yet')).toBeInTheDocument()
  })
})
