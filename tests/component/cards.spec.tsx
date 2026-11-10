// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OAIApprovalAction, StoredSessionItem } from '@/api/types'
import { applyItems, initialState, type MessageView } from '@/chat/reducer'
import { ConnectionPill } from '@/ui/chat/ConnectionPill'
import { Message } from '@/ui/chat/Message'
import { summarizeArgs } from '@/ui/chat/ToolCard'
import { ErrorBanner } from '@/ui/errors/ErrorBanner'
import live from '../fixtures/live/web-search.json'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const noAnswer = vi.fn(async () => {})
const isDisabled = (el: HTMLElement) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const approval: OAIApprovalAction = {
  type: 'approval',
  id: 'appr_1',
  kind: 'tool_approval',
  prompt: 'Allow delete_files to remove /tmp/mock?',
  options: ['approve', 'deny'],
  tool_name: 'delete_files',
  call_id: 'call_1',
}

const question: OAIApprovalAction = {
  type: 'approval',
  id: 'appr_q',
  kind: 'user_question',
  prompt: 'Which color do you prefer?',
  options: ['Red', 'Blue'],
  questions: [{ id: 'q1', question: 'Which color do you prefer?', options: [{ label: 'Red' }, { label: 'Blue' }] }],
}

describe('views', () => {
  it('renders a user message as a bubble with its text', () => {
    render(<Message view={{ kind: 'user', id: 'u1', text: 'Hello\nthere' }} answer={noAnswer} />)
    expect(screen.getByText(/Hello\s+there/)).toBeInTheDocument()
  })

  it('renders assistant Markdown, polite live region while streaming', () => {
    const view: MessageView = { kind: 'assistant', id: 'a1', text: 'Some **bold** text', streaming: true }
    const { rerender } = render(<Message view={view} answer={noAnswer} />)
    expect(screen.getByTestId('assistant-message')).toHaveAttribute('aria-live', 'polite')
    rerender(<Message view={{ ...view, streaming: false }} answer={noAnswer} />)
    expect(screen.getByTestId('assistant-message')).not.toHaveAttribute('aria-live')
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('renders code blocks with a copy button and never parses raw HTML', () => {
    const text = 'Run:\n\n```bash\necho hi\n```\n\n<img src=x onerror=alert(1)>'
    const { container } = render(<Message view={{ kind: 'assistant', id: 'a1', text, streaming: false }} answer={noAnswer} />)
    expect(container.querySelector('pre')).toHaveTextContent('echo hi')
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('never loads a remote image: it becomes a link labelled with the alt text', () => {
    const text = 'Inline ![secret chart](https://evil.example/p?d=secret) here.\n\n![](https://evil.example/block.png)'
    const { container } = render(<Message view={{ kind: 'assistant', id: 'a1', text, streaming: false }} answer={noAnswer} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toMatch(/<img|srcset|background/i)
    const inline = screen.getByRole('link', { name: /Image: secret chart/ })
    expect(inline).toHaveAttribute('href', 'https://evil.example/p?d=secret')
    expect(inline).toHaveAttribute('target', '_blank')
    expect(inline.getAttribute('rel')).toMatch(/noreferrer/)
    expect(screen.getByRole('link', { name: /Image: https:\/\/evil\.example\/block\.png/ })).toHaveAttribute(
      'href',
      'https://evil.example/block.png',
    )
  })

  it('typesets math', () => {
    const { container } = render(<Message view={{ kind: 'assistant', id: 'a1', text: 'Energy $E=mc^2$.', streaming: false }} answer={noAnswer} />)
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('renders finished reasoning collapsed to one line, expandable', async () => {
    const user = userEvent.setup()
    render(<Message view={{ kind: 'reasoning', id: 'r1', text: 'Considering the options\nand more', streaming: false }} answer={noAnswer} />)
    const trigger = screen.getByRole('button', { name: /Thought/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('Considering the options')
    expect(trigger).not.toHaveTextContent('and more')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Considering the options\s+and more/)).toBeVisible()
  })

  it('keeps streaming reasoning open under "Thinking…" and collapses it when it ends', () => {
    const view: MessageView = { kind: 'reasoning', id: 'r1', text: 'Looking things up', streaming: true }
    const { rerender } = render(<Message view={view} answer={noAnswer} />)
    expect(screen.getByRole('button', { name: /Thinking…/ })).toHaveAttribute('aria-expanded', 'true')
    rerender(<Message view={{ ...view, streaming: false }} answer={noAnswer} />)
    expect(screen.getByRole('button', { name: /Thought/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('gives the reasoning label its own fixed slot and the summary the fill slot (the label never wraps)', () => {
    const text = `${'A long first line of reasoning that goes on '.repeat(10)}\nsecond line`
    render(<Message view={{ kind: 'reasoning', id: 'r1', text, streaming: false }} answer={noAnswer} />)
    const header = screen.getByTestId('reasoning-header')
    const [label, summary] = Array.from(header.children) as HTMLElement[]
    expect(header.children).toHaveLength(2)
    expect(label).toHaveTextContent(/^Thought$/)
    expect(label).not.toHaveAttribute('data-size', 'fill')
    expect(summary).toHaveAttribute('data-size', 'fill')
    expect(summary).toHaveTextContent(/^A long first line/)
    expect(summary).not.toHaveTextContent('second line')
  })

  it('renders nothing for an empty assistant message', () => {
    const { container } = render(<Message view={{ kind: 'assistant', id: 'a1', text: '', streaming: false }} answer={noAnswer} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the recorded web_search call as a tool card with its queries and a capped output', async () => {
    const user = userEvent.setup()
    const s = applyItems(initialState('s'), (live as unknown as { items: StoredSessionItem[] }).items)
    const tools = s.items.filter((v) => v.kind === 'tool')
    render(<>{tools.map((v) => <Message key={v.id} view={v} answer={noAnswer} />)}</>)
    expect(screen.getByText('web_search')).toBeInTheDocument()
    expect(screen.getByText('web_fetch')).toBeInTheDocument()
    expect(screen.getByText(/^latest stable Node\.js release version/)).toBeInTheDocument()
    expect(screen.getByText('https://nodejs.org/dist/index.json')).toBeInTheDocument()
    expect(screen.queryAllByRole('status', { name: /running/i })).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: /web_fetch/ }))
    expect(document.body).toHaveTextContent(/more characters\)/)
  })

  it('renders a tool card with name, argument summary and status, and expands to the full input and output', async () => {
    const user = userEvent.setup()
    const args = { query: 'weather in Kuala Lumpur', limit: 5 }
    const view: MessageView = { kind: 'tool', id: 't1', callId: 'c1', name: 'search', args, status: 'done', output: '3 results: alpha, beta, gamma' }
    render(<Message view={view} answer={noAnswer} />)
    expect(screen.getByText('search')).toBeInTheDocument()
    expect(screen.getByText('weather in Kuala Lumpur')).toBeInTheDocument()
    expect(screen.queryByText('3 results: alpha, beta, gamma')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /search/ }))
    expect(await screen.findByText('3 results: alpha, beta, gamma')).toBeInTheDocument()
    expect(document.body).toHaveTextContent('"limit": 5')
  })

  it('summarizes long or structured arguments', () => {
    expect(summarizeArgs({ path: '/tmp/x' })).toBe('/tmp/x')
    expect(summarizeArgs('{"n":1}')).toBe('{"n":1}')
    expect(summarizeArgs({ text: 'a'.repeat(100) })).toHaveLength(60)
    expect(summarizeArgs({ queries: ['one', 'two'] })).toBe('one, two')
  })

  it('renders a notice with Retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <Message view={{ kind: 'notice', id: 'n1', level: 'failed', message: 'Mock failure: the model is unavailable' }} answer={noAnswer} onRetry={onRetry} />,
    )
    expect(screen.getByText('The turn failed')).toBeInTheDocument()
    expect(screen.getByText('Mock failure: the model is unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows "Reconnecting…" only while reconnecting', () => {
    const { rerender } = render(<ConnectionPill connection="live" />)
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
    rerender(<ConnectionPill connection="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…')
  })

  it('error banner retries', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorBanner message="store_unavailable" onRetry={onRetry} />)
    expect(screen.getByText('Agentry is temporarily unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('ApprovalCard', () => {
  it('Allow answers approve, and focus starts on Allow', async () => {
    const user = userEvent.setup()
    const answer = vi.fn(async () => {})
    render(<Message view={{ kind: 'action', id: 'action:appr_1', action: approval }} answer={answer} />)
    expect(screen.getByText('Allow delete_files to remove /tmp/mock?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Allow' }))
    expect(answer).toHaveBeenCalledWith('appr_1', { decision: 'approve' })
  })

  it('Deny answers deny', async () => {
    const user = userEvent.setup()
    const answer = vi.fn(async () => {})
    render(<Message view={{ kind: 'action', id: 'action:appr_1', action: approval }} answer={answer} />)
    await user.click(screen.getByRole('button', { name: 'Deny' }))
    expect(answer).toHaveBeenCalledWith('appr_1', { decision: 'deny' })
  })

  it('shows the error when the answer fails', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('@/api/client')
    const answer = vi.fn(async () => {
      throw new ApiError(404, 'approval_not_found', 'This approval is no longer pending')
    })
    render(<Message view={{ kind: 'action', id: 'action:appr_1', action: approval }} answer={answer} />)
    await user.click(screen.getByRole('button', { name: 'Allow' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This approval is no longer pending')
  })
})

describe('QuestionCard', () => {
  it('answers with a chosen option, and focus starts on the first option', async () => {
    const user = userEvent.setup()
    const answer = vi.fn(async () => {})
    render(<Message view={{ kind: 'action', id: 'action:appr_q', action: question }} answer={answer} />)
    const red = screen.getByRole('radio', { name: 'Red' })
    expect(red).toHaveFocus()
    expect(isDisabled(screen.getByRole('button', { name: 'Send answer' }))).toBe(true)
    await user.click(red)
    await user.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(answer).toHaveBeenCalledWith('appr_q', { decision: 'answer', payload: { selected: ['Red'] } })
  })

  it('answers with free text', async () => {
    const user = userEvent.setup()
    const answer = vi.fn(async () => {})
    render(<Message view={{ kind: 'action', id: 'action:appr_q', action: question }} answer={answer} />)
    await user.type(screen.getByRole('textbox', { name: 'Or type your own answer' }), 'Green')
    await user.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(answer).toHaveBeenCalledWith('appr_q', { decision: 'answer', payload: { selected: [], custom: 'Green' } })
  })

  it('works with a free-text-only question and Enter submits', async () => {
    const user = userEvent.setup()
    const answer = vi.fn(async () => {})
    const freeText: OAIApprovalAction = { ...question, options: [], questions: undefined, prompt: 'What is the project name?' }
    render(<Message view={{ kind: 'action', id: 'action:appr_q', action: freeText }} answer={answer} />)
    expect(screen.getByText('What is the project name?')).toBeInTheDocument()
    const field = screen.getByRole('textbox', { name: 'Your answer' })
    expect(field).toHaveFocus()
    await user.type(field, 'Agentry{Enter}')
    expect(answer).toHaveBeenCalledWith('appr_q', { decision: 'answer', payload: { selected: [], custom: 'Agentry' } })
  })

  it('Skip declines', async () => {
    const user = userEvent.setup()
    const answer = vi.fn(async () => {})
    render(<Message view={{ kind: 'action', id: 'action:appr_q', action: question }} answer={answer} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(answer).toHaveBeenCalledWith('appr_q', { decision: 'deny' })
  })
})

describe('action cards inside the list', () => {
  it('only the approval card is a group with its own controls', () => {
    render(<Message view={{ kind: 'action', id: 'action:appr_1', action: approval }} answer={noAnswer} />)
    const group = screen.getByRole('group', { name: 'Approval needed' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
  })
})

describe('Conversation', () => {
  it('shows a notice when the stream route refuses the chat (403)', async () => {
    const { Conversation } = await import('@/ui/chat/Conversation')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/items')) return Response.json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false })
        if (url.endsWith('/stream')) return Response.json({ error: 'forbidden' }, { status: 403 })
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }),
    )
    try {
      render(<Conversation sessionId="sess_x" />)
      expect(await screen.findByText('Live updates are not available')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
