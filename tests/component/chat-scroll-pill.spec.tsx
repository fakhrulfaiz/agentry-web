// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredSessionItem } from '@/api/types'
import { Conversation } from '@/ui/chat/Conversation'

vi.mock('next/navigation', () => ({
  usePathname: () => '/c/chat_scroll_pill',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

const SID = 'chat_scroll_pill'
const session = {
  id: SID,
  object: 'agent.session',
  created_at: 1,
  last_active_at: 1,
  status: 'in_progress',
  error: null,
  metadata: { title: 'Scrolling chat' },
  vault_ids: [],
  agent: { id: 'a', object: 'agent', created_at: 1, updated_at: 1, name: null, instructions: null, model: 'mock-model', metadata: {}, tools: [] },
  environment: { type: 'local' },
  required_actions: [],
  usage: null,
}
const items: StoredSessionItem[] = [
  { id: 'item_user', type: 'message', role: 'user', status: 'completed', turn_id: 'turn_1', content: [{ type: 'input_text', text: 'Hello' }] },
  { id: 'item_first', type: 'message', role: 'assistant', status: 'completed', turn_id: 'turn_1', content: [{ type: 'output_text', text: 'First answer' }] },
]

/** A controllable stand-in for the browser's ResizeObserver (jsdom has none). */
class TestResizeObserver {
  static all: TestResizeObserver[] = []
  private targets = new Set<Element>()
  private callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.all.push(this)
  }
  observe(el: Element) {
    this.targets.add(el)
  }
  unobserve(el: Element) {
    this.targets.delete(el)
  }
  disconnect() {
    this.targets.clear()
  }
  resize(el: Element) {
    if (!this.targets.has(el)) return
    this.callback([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

let stream!: ReadableStreamDefaultController<Uint8Array>

function emit(event: unknown) {
  act(() => {
    stream.enqueue(new TextEncoder().encode(`id: evt_new\ndata: ${JSON.stringify(event)}\n\n`))
  })
}

beforeEach(() => {
  TestResizeObserver.all = []
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  document.head.innerHTML = '<meta name="agentry-csrf" content="t">'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const list = (data: unknown[]) => Response.json({ object: 'list', data, first_id: null, last_id: null, has_more: false })
      if (init?.method === 'POST') return Response.json({})
      if (url.startsWith(`/api/agentry/agents/sessions/${SID}/items`)) return list(items)
      if (url.startsWith(`/api/agentry/agents/sessions/${SID}/turns`)) return list([])
      if (url.startsWith(`/api/agentry/agents/sessions/${SID}/subagents`)) return list([])
      if (url === `/api/agentry/agents/sessions/${SID}`) return Response.json(session)
      if (url.endsWith('/stream')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      return Response.json({ error: 'not_found' }, { status: 404 })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** A chat with jsdom scroll metrics: 500px of visible area in a 1000px scrollable column. */
async function renderChat() {
  render(<Conversation sessionId={SID} />)
  // Both Chat and Trajectory stay mounted, so the answer appears in both panes.
  expect((await screen.findAllByText('First answer')).length).toBeGreaterThan(0)

  const log = document.querySelector('[role="log"]')!
  const content = log.firstElementChild!
  const scroller = log.parentElement!.parentElement!
  let scrollHeight = 1000
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 })
  Object.defineProperty(scroller, 'offsetHeight', { configurable: true, value: 500 })
  const setHeight = (height: number) => { scrollHeight = height }

  // Start at the bottom (as the chat's first fill does), then leave it.
  act(() => {
    scroller.scrollTop = 500
    scroller.dispatchEvent(new Event('scroll'))
  })
  act(() => {
    scroller.scrollTop = 300
    scroller.dispatchEvent(new Event('scroll'))
  })

  /** Fires every registered ResizeObserver for the chat's content, as a browser would after it grows. */
  const grow = () => {
    act(() => {
      for (const observer of TestResizeObserver.all) observer.resize(content)
    })
  }
  const newAnswer = async () => {
    emit({ type: 'agent.session.turn.output_text.done', event_id: 'evt_new', item_id: 'item_new', output_index: 0, content_index: 0, session_id: SID, turn_id: 'turn_1', text: 'New answer' })
    expect((await screen.findAllByText('New answer')).length).toBeGreaterThan(0)
    grow()
  }
  return { scroller, setHeight, newAnswer }
}

describe('scroll-to-bottom pill during streaming', () => {
  it('hides the “New messages” pill once the reader is back at the bottom', async () => {
    const { scroller, setHeight, newAnswer } = await renderChat()
    await newAnswer()
    expect(await screen.findByRole('button', { name: 'New messages' })).toBeInTheDocument()

    // Scrolling back down is enough; the reader should not have to click the pill to clear it.
    act(() => {
      setHeight(1500)
      scroller.scrollTop = 1000
      scroller.dispatchEvent(new Event('scroll'))
      scroller.dispatchEvent(new Event('scrollend'))
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New messages' })).not.toBeInTheDocument())
  })

  it('still takes the reader to the newest message when clicked', async () => {
    const { scroller, setHeight, newAnswer } = await renderChat()
    await newAnswer()
    const toBottom = vi.fn(({ top }: ScrollToOptions) => {
      scroller.scrollTop = top ?? 0
      scroller.dispatchEvent(new Event('scroll'))
      scroller.dispatchEvent(new Event('scrollend'))
    })
    Object.defineProperty(scroller, 'scrollTo', { configurable: true, value: toBottom })
    setHeight(1500)

    await userEvent.click(screen.getByRole('button', { name: 'New messages' }))
    expect(toBottom).toHaveBeenCalledWith({ top: 1500, behavior: 'smooth' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New messages' })).not.toBeInTheDocument())
  })
})
