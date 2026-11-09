// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAITurn, StoredSessionItem } from '@/api/types'
import { Conversation } from '@/ui/chat/Conversation'

// The chat's title menu navigates home after a delete.
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
import { buildTrajectory, type SubagentRun } from '@/ui/trajectory/build-trajectory'
import { CHIP } from '@/ui/trajectory/labels'
import { TrajectoryView } from '@/ui/trajectory/TrajectoryView'
import delegation from '../fixtures/live/subagent.json'
import live from '../fixtures/live/web-search.json'

const WEB = buildTrajectory(live.turns as OAITurn[], live.items as StoredSessionItem[], [], { model: 'mock-model' })
const DELEGATION = buildTrajectory(delegation.turns as OAITurn[], delegation.items as StoredSessionItem[], delegation.subagents as unknown as SubagentRun[])

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Harness({ trajectory, onShowInChat = vi.fn() }: { trajectory: typeof WEB; onShowInChat?: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  return <TrajectoryView trajectory={trajectory} selectedId={selected} onSelect={setSelected} onShowInChat={onShowInChat} />
}

const rows = () => screen.queryAllByTestId('trajectory-row')
const chips = () => rows().map((r) => within(r).getByTestId('kind-chip').getAttribute('data-kind'))

describe('TrajectoryView ledger', () => {
  it('shows Turn 1 with its Input, Output, Think and Time, then a row per record', () => {
    render(<Harness trajectory={WEB} />)
    const turn = screen.getByRole('region', { name: 'Turn 1' })
    for (const label of ['Input', 'Output', 'Think', 'Time']) expect(within(turn).getByText(label)).toBeInTheDocument()
    expect(within(turn).getByText('13 s')).toBeInTheDocument()
    expect(chips()).toEqual(['user', 'thinking', 'tool', 'thinking', 'tool', 'assistant'])
    expect(rows()[2]).toHaveTextContent('web_search')
    expect(rows()[5]).toHaveTextContent('Step 3 · mock-model')
  })

  it('gives every kind its own chip colour, also in the inspector header', async () => {
    const colors = Object.values(CHIP).map((c) => c.color)
    expect(new Set(colors).size).toBe(colors.length)
    render(<Harness trajectory={DELEGATION} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trajectory-subcalls-summary'))
    const seen = new Map<string, string>()
    for (const chip of screen.getAllByTestId('kind-chip')) seen.set(chip.getAttribute('data-kind')!, chip.getAttribute('data-color')!)
    expect([...seen.keys()].sort()).toEqual(['assistant', 'subtool', 'thinking', 'tool', 'user'])
    for (const [kind, color] of seen) expect(color).toBe(CHIP[kind as keyof typeof CHIP].color)
    await user.click(rows()[0])
    const inspector = await screen.findByTestId('trajectory-inspector')
    expect(within(inspector).getByTestId('kind-chip')).toHaveAttribute('data-color', CHIP.user.color)
  })

  it('folds turns, calls and subcalls from the toolbar', async () => {
    const user = userEvent.setup()
    render(<Harness trajectory={WEB} />)
    await user.click(screen.getByRole('button', { name: 'Calls' }))
    expect(chips()).toEqual(['user', 'thinking', 'thinking', 'assistant'])
    expect(screen.getAllByTestId('trajectory-calls-summary').map((s) => s.textContent)).toEqual(['1 tool call', '1 tool call'])
    await user.click(screen.getAllByTestId('trajectory-calls-summary')[0])
    expect(chips()).toEqual(['user', 'thinking', 'tool', 'thinking', 'assistant'])
    await user.click(screen.getByRole('button', { name: 'Turns' }))
    expect(rows()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Turns' }))
    expect(rows().length).toBeGreaterThan(0)
  })

  it('subcalls start folded into a summary that expands', async () => {
    const user = userEvent.setup()
    render(<Harness trajectory={DELEGATION} />)
    const call = DELEGATION.turns[0].records.find((r) => r.name === 'subagent')!
    const summary = screen.getByTestId('trajectory-subcalls-summary')
    expect(summary).toHaveTextContent(`${call.subcalls!.length} subcalls`)
    expect(chips()).not.toContain('subtool')
    await user.click(summary)
    expect(chips().filter((k) => k === 'subtool')).toHaveLength(call.subcalls!.length)
  })

  it('search filters rows and reaches folded subcalls', async () => {
    const user = userEvent.setup()
    render(<Harness trajectory={DELEGATION} />)
    await user.type(screen.getByRole('textbox', { name: 'Search trajectory' }), 'ls -la')
    await waitFor(() => expect(chips()).toContain('subtool'))
    // Matches (the subagent's own command, the follow-up turn's commands) and the call a matching subcall sits under.
    expect(rows()[0]).toHaveTextContent('List workspace files and count')
    expect(rows().filter((r) => /SUBTOOLcommand.*ls -la/.test(r.textContent ?? ''))).toHaveLength(1)
    expect(rows().some((r) => r.textContent?.includes('glob'))).toBe(false)
    expect(rows().filter((r) => within(r).getByTestId('kind-chip').getAttribute('data-kind') === 'tool').every((r) => /ls -la|subagent/.test(r.textContent ?? ''))).toBe(true)
  })
})

describe('TrajectoryView inspector', () => {
  it('selecting a tool row opens its details; missing timing says Not recorded', async () => {
    const user = userEvent.setup()
    const onShowInChat = vi.fn()
    render(<Harness trajectory={WEB} onShowInChat={onShowInChat} />)
    await user.click(rows()[2])
    const inspector = await screen.findByTestId('trajectory-inspector')
    for (const name of ['Token usage', 'Duration', 'Input', 'Output', 'Timing']) expect(within(inspector).getByRole('region', { name })).toBeInTheDocument()
    expect(within(inspector).getByText('Usage not reported')).toBeInTheDocument()
    const timing = within(inspector).getByRole('region', { name: 'Timing' })
    expect(within(timing).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(3)
    expect(within(inspector).getByTestId('json-tree')).toHaveTextContent('latest stable Node.js release version')
    await user.click(within(inspector).getByRole('button', { name: 'Show input as raw JSON' }))
    expect(within(inspector).queryByTestId('json-tree')).not.toBeInTheDocument()
    await user.click(within(inspector).getByRole('button', { name: 'Show in chat' }))
    expect(onShowInChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'item_fn_19', chatItemId: 'item_fn_19' }))
  })

  it('an Assistant step shows its thinking', async () => {
    const user = userEvent.setup()
    render(<Harness trajectory={WEB} />)
    await user.click(rows()[5])
    const inspector = await screen.findByTestId('trajectory-inspector')
    expect(within(inspector).getByRole('region', { name: 'Thinking' })).toHaveTextContent('The canonical index shows v26.13.0')
    expect(within(inspector).getByRole('region', { name: 'Output' })).toHaveTextContent('v26.13.0')
  })
})

describe('Conversation views', () => {
  const SID = live.session_id
  const list = (data: unknown[]) => Response.json({ object: 'list', data, first_id: null, last_id: null, has_more: false })
  const session = { id: SID, object: 'agent.session', created_at: 1, last_active_at: 1, status: 'idle', error: null, metadata: { title: 'Node release' }, vault_ids: [], agent: { id: 'a', object: 'agent', created_at: 1, updated_at: 1, name: null, instructions: null, model: 'mock-model', metadata: {}, tools: [] }, environment: { type: 'local' }, required_actions: [], usage: null }

  beforeEach(() => {
    document.head.innerHTML = '<meta name="agentry-csrf" content="t">'
    window.localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/stream')) return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
        if (url.startsWith(`/api/agentry/agents/sessions/${SID}/items`)) return list(live.items)
        if (url.startsWith(`/api/agentry/agents/sessions/${SID}/turns`)) return list(live.turns)
        if (url === `/api/agentry/agents/sessions/${SID}`) return Response.json(session)
        return Response.json({ error: 'not_found' }, { status: 404 })
      }),
    )
  })

  it('switches to Trajectory, remembers it, and "Show in chat" scrolls to the item', async () => {
    const user = userEvent.setup()
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this)
    })
    const first = render(<Conversation sessionId={SID} />)
    // The title is the chat's menu button.
    expect(await screen.findByRole('button', { name: 'Node release' })).toHaveAttribute('aria-haspopup')
    await user.click(await screen.findByRole('button', { name: 'Trajectory' }))
    expect(window.localStorage.getItem(`agentry_view:${SID}`)).toBe('trajectory')
    // The chat stays mounted, hidden and inert behind the trajectory.
    expect(screen.getByTestId('chat-pane')).toHaveAttribute('inert')
    expect(screen.getByTestId('trajectory-pane')).not.toHaveAttribute('inert')
    first.unmount()

    // Reopened: the saved view comes back.
    render(<Conversation sessionId={SID} />)
    await user.click((await screen.findAllByTestId('trajectory-row'))[4]) // web_fetch
    await user.click(await screen.findByRole('button', { name: 'Show in chat' }))
    await waitFor(() => expect(scrolled.some((el) => el.getAttribute('data-item-id') === 'item_fn_27')).toBe(true))
    expect(screen.getByTestId('chat-pane')).not.toHaveAttribute('inert')
    expect(screen.getByTestId('trajectory-pane')).toHaveAttribute('inert')
    await act(async () => {})
  })

  it('keeps the composer draft (and the chat itself) across view switches', async () => {
    const user = userEvent.setup()
    render(<Conversation sessionId={SID} />)
    const input = await screen.findByRole('textbox', { name: 'Message input' })
    await user.click(input)
    await user.keyboard('a long draft about Node')
    const chatRow = screen.getAllByTestId('assistant-message').at(-1)
    for (let i = 0; i < 2; i++) {
      await user.click(await screen.findByRole('button', { name: 'Trajectory' }))
      await user.click(screen.getByRole('button', { name: 'Chat' }))
    }
    // The same editor and rows: nothing was unmounted.
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBe(input)
    expect(input).toHaveTextContent('a long draft about Node')
    expect(screen.getAllByTestId('assistant-message').at(-1)).toBe(chatRow)
    await act(async () => {})
  })
})
