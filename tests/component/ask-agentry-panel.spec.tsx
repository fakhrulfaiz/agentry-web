// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIApprovalAction } from '@/api/types'
import { initialState } from '@/chat/reducer'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const apiMock = vi.hoisted(() => ({ models: vi.fn(), createSession: vi.fn(), getSession: vi.fn(), listSkills: vi.fn(), listCommands: vi.fn() }))
const pendingFirst = vi.hoisted(() => ({ setPendingFirst: vi.fn() }))
const conversation = vi.hoisted(() => ({
  answer: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  runCommand: vi.fn(async () => {}),
  state: null as unknown,
  closedReason: null as string | null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  usePathname: () => '/scheduled',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return { ...original, api: apiMock }
})
vi.mock('@/chat/pending-first', () => ({ setPendingFirst: pendingFirst.setPendingFirst }))
vi.mock('@/chat/use-conversation', () => ({
  goToLogin: vi.fn(),
  useConversation: () => ({
    state: conversation.state,
    loaded: true,
    ready: true,
    firstSend: null,
    connection: 'live',
    closedReason: conversation.closedReason,
    send: conversation.send,
    stop: conversation.stop,
    answer: conversation.answer,
    runCommand: conversation.runCommand,
  }),
}))

const { AskAgentryPanel } = await import('@/ui/chat/AskAgentryPanel')

const approval: OAIApprovalAction = {
  type: 'approval',
  id: 'act_1',
  kind: 'tool_approval',
  prompt: 'Allow delete_files to remove /tmp/mock?',
  options: ['approve', 'deny'],
  tool_name: 'delete_files',
}

beforeEach(() => {
  nav.push.mockReset()
  nav.replace.mockReset()
  conversation.answer.mockReset()
  conversation.answer.mockImplementation(async () => {})
  conversation.state = initialState('sess_1')
  conversation.closedReason = null
  apiMock.models.mockResolvedValue(['m1'])
  apiMock.createSession.mockResolvedValue({ id: 'sess_1' })
  apiMock.getSession.mockResolvedValue({ id: 'sess_1', object: 'agent.session', status: 'idle', agent: { model: 'm1', reasoning: { effort: null } } })
  apiMock.listSkills.mockResolvedValue({ object: 'list', data: [] })
  apiMock.listCommands.mockResolvedValue({ object: 'list', data: [] })
  pendingFirst.setPendingFirst.mockReset()
})
afterEach(() => cleanup())

describe('Ask Agentry panel', () => {
  it('creates a helper session on the first send without navigating', async () => {
    let releaseModels!: (value: string[]) => void
    apiMock.models.mockReturnValue(new Promise((resolve) => { releaseModels = resolve }))
    const onSessionCreated = vi.fn()
    render(<AskAgentryPanel sessionId={null} onSessionCreated={onSessionCreated} />)
    // No model list yet: the composer waits instead of sending with an empty model.
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    expect(screen.queryByText('m1')).not.toBeInTheDocument()
    await act(async () => { releaseModels(['m1']) })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('m1'))

    await userEvent.type(screen.getByRole('combobox', { name: 'Message input' }), 'Help me plan{Enter}')
    await waitFor(() => expect(apiMock.createSession).toHaveBeenCalledWith(expect.objectContaining({ text: 'Help me plan', agentId: 'agentry' })))
    expect(pendingFirst.setPendingFirst).toHaveBeenCalledWith('sess_1', expect.objectContaining({ text: 'Help me plan' }))
    expect(onSessionCreated).toHaveBeenCalledWith('sess_1')
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('answers an approval card through the conversation hook', async () => {
    conversation.state = {
      ...initialState('sess_1'),
      items: [{ kind: 'action', id: 'action:act_1', action: approval }],
    }
    render(<AskAgentryPanel sessionId="sess_1" onSessionCreated={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(conversation.answer).toHaveBeenCalledWith('act_1', { decision: 'approve' })
  })

  it('offers a new chat when the restored session no longer exists', async () => {
    conversation.closedReason = 'not_found'
    const onNewChat = vi.fn()
    render(<AskAgentryPanel sessionId="missing" onSessionCreated={vi.fn()} onNewChat={onNewChat} />)
    await userEvent.click(await screen.findByRole('button', { name: 'New chat' }))
    expect(onNewChat).toHaveBeenCalled()
  })
})
