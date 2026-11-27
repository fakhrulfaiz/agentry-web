// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  document.head.innerHTML = '<meta name="agentry-csrf" content="t">'
  window.localStorage.clear()
  const snapshot = new Promise<Response>((resolve) => { resolveSession = resolve })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith(`/api/agentry/agents/sessions/${SID}/items`)) return list([])
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
})
