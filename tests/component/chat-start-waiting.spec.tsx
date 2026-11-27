// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredSessionItem } from '@/api/types'
import { clearPendingFirst, setPendingFirst } from '@/chat/pending-first'
import { Conversation } from '@/ui/chat/Conversation'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

const SID = 'sess_start_waiting'
const list = (data: unknown[]) => Response.json({ object: 'list', data, first_id: null, last_id: null, has_more: false })
const session = { id: SID, object: 'agent.session', created_at: 1, last_active_at: 1, status: 'idle', error: null, metadata: { title: 'First message' }, vault_ids: [], agent: { id: 'a', object: 'agent', created_at: 1, updated_at: 1, name: null, instructions: null, model: 'mock-model', metadata: {}, tools: [] }, environment: { type: 'local' }, required_actions: [], usage: null }

let resolveSession!: (response: Response) => void
let items: unknown[] = []

beforeEach(() => {
  document.head.innerHTML = '<meta name="agentry-csrf" content="t">'
  window.localStorage.clear()
  items = []
  const snapshot = new Promise<Response>((resolve) => { resolveSession = resolve })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return Response.json({})
      if (url.startsWith(`/api/agentry/agents/sessions/${SID}/items`)) return list(items)
      if (url.startsWith(`/api/agentry/agents/sessions/${SID}/turns`)) return list([])
      if (url.startsWith(`/api/agentry/agents/sessions/${SID}/subagents`)) return list([])
      if (url === `/api/agentry/agents/sessions/${SID}`) return snapshot
      if (url.endsWith('/stream')) return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      return Response.json({ error: 'not_found' }, { status: 404 })
    }),
  )
})

afterEach(() => {
  clearPendingFirst(SID)
  cleanup()
  vi.unstubAllGlobals()
})

describe('first-send waiting row', () => {
  it('keeps the start label until the session is ready, then says thinking', async () => {
    setPendingFirst(SID, { text: 'hello there', startLabel: 'Starting the chat…' })
    render(<Conversation sessionId={SID} />)
    expect(await screen.findByText('Starting the chat…')).toBeInTheDocument()
    expect(screen.queryByText('Loading conversation…')).not.toBeInTheDocument()
    await act(async () => { resolveSession(Response.json({ ...session, status: 'in_progress' })) })
    await waitFor(() => expect(screen.getByText('Agentry is thinking…')).toBeInTheDocument())
    expect(screen.queryByText('Loading conversation…')).not.toBeInTheDocument()
  })

  it('keeps the handoff when React runs effects twice in development', async () => {
    setPendingFirst(SID, { text: 'hello there', startLabel: 'Starting the chat…' })
    render(<StrictMode><Conversation sessionId={SID} /></StrictMode>)
    expect(await screen.findByText('Starting the chat…')).toBeInTheDocument()
    expect(screen.queryByText('Loading conversation…')).not.toBeInTheDocument()
  })

  it('shows the waiting row for a second send even though an earlier turn produced output', async () => {
    const earlier: StoredSessionItem = {
      id: 'item_earlier', type: 'message', role: 'assistant', status: 'completed', turn_id: 'turn_1',
      content: [{ type: 'output_text', text: 'Earlier answer' }],
    }
    items = [earlier]
    resolveSession(Response.json({ ...session, status: 'idle' }))
    render(<Conversation sessionId={SID} />)
    expect((await screen.findAllByText('Earlier answer')).length).toBeGreaterThan(0)
    const input = screen.queryByRole('combobox', { name: 'Message input' }) ?? screen.getByRole('textbox', { name: 'Message input' })
    await userEvent.type(input, 'second question{Enter}')
    expect(await screen.findByText('Sending…')).toBeInTheDocument()
  })
})
