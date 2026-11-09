// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Conversation, REVEAL_FRAMES } from '@/ui/chat/Conversation'
import live from '../fixtures/live/web-search.json'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
// The row lookup is scripted: "not rendered yet" for some frames.
const scroll = vi.hoisted(() => ({ found: (_id: string): boolean => false, calls: 0 }))
vi.mock('@/ui/chat/reveal', () => ({
  scrollToItem: (id: string) => {
    scroll.calls += 1
    return scroll.found(id)
  },
}))

const SID = live.session_id
const list = (data: unknown[]) => Response.json({ object: 'list', data, first_id: null, last_id: null, has_more: false })
const session = { id: SID, object: 'agent.session', created_at: 1, last_active_at: 1, status: 'idle', error: null, metadata: { title: 'Node release' }, vault_ids: [], agent: { id: 'a', object: 'agent', created_at: 1, updated_at: 1, name: null, instructions: null, model: 'mock-model', metadata: {}, tools: [] }, environment: { type: 'local' }, required_actions: [], usage: null }

beforeEach(() => {
  document.head.innerHTML = '<meta name="agentry-csrf" content="t">'
  window.localStorage.clear()
  scroll.calls = 0
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Opens the web_fetch record and clicks "Show in chat". */
async function showInChat(): Promise<void> {
  const user = userEvent.setup()
  render(<Conversation sessionId={SID} />)
  await user.click(await screen.findByRole('button', { name: 'Trajectory' }))
  await user.click((await screen.findAllByTestId('trajectory-row'))[4]) // web_fetch
  await user.click(await screen.findByRole('button', { name: 'Show in chat' }))
}

describe('"Show in chat"', () => {
  it('waits a few frames for the row to render, then scrolls to it once', async () => {
    let misses = 3
    scroll.found = () => misses-- <= 0
    await showInChat()
    await waitFor(() => expect(scroll.calls).toBe(4))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(scroll.calls).toBe(4)
    expect(screen.queryByText('That step is not shown in the chat.')).not.toBeInTheDocument()
  })

  it('says so when the row never shows up', async () => {
    scroll.found = () => false
    await showInChat()
    expect(await screen.findByText('That step is not shown in the chat.')).toBeInTheDocument()
    expect(scroll.calls).toBe(REVEAL_FRAMES)
    await act(async () => {})
  })
})
