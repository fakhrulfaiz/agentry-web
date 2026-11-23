// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentForm } from '@/ui/agents/AgentForm'

const { apiMock, nav } = vi.hoisted(() => ({
  apiMock: {
    models: vi.fn(async () => ['m1', 'm2']),
    listHostTools: vi.fn(async () => [{ name: 'read_file' }, { name: 'grep' }, { name: 'shell' }]),
    createAgent: vi.fn(async () => ({ id: 'agent_9' })),
    updateAgent: vi.fn(),
    getAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listSkills: vi.fn(async () => ({ object: 'list', data: [
      { name: 'composio', kind: 'builtin', enabled: true },
      { name: 'create-agent', kind: 'builtin', enabled: true },
      { name: 'office-docx', kind: 'bundled', enabled: true },
    ] })),
    listInstalledSkills: vi.fn(async (scope?: string) => (scope === 'library' ? [{ id: `skill_${'a'.repeat(32)}`, name: 'haiku', status: 'active', scope: 'library' }] : [])),
  },
  nav: { push: vi.fn(), params: new URLSearchParams() },
}))
vi.mock('@/api/client', async (orig) => ({ ...(await orig<object>()), api: apiMock }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => nav.params }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  nav.params = new URLSearchParams()
  vi.unstubAllGlobals()
})

describe('AgentForm skills and apps', () => {
  const LIB = `skill_${'a'.repeat(32)}`
  it('choosing skills saves every built-in plus the ticked library skill; office stays on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Poet')
    await userEvent.click(screen.getByRole('switch', { name: /Use all built-in skills/ }))
    const office = await screen.findByRole('checkbox', { name: /office-docx/ })
    expect(office).toBeChecked()
    expect(office).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('checkbox', { name: /haiku/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ skills: { builtin: ['composio', 'create-agent'], library: [LIB] } })
  })

  it('limits apps: Off drops an app and Choose tools saves the typed slugs; sending policy saves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: ['gmail', 'github'] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Mail')
    await userEvent.click(await screen.findByRole('switch', { name: /Limit this agent to specific apps/ }))
    await userEvent.click(within(screen.getByRole('group', { name: 'github access' })).getByRole('button', { name: 'Off' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'gmail access' })).getByRole('button', { name: 'Choose tools' }))
    await userEvent.type(screen.getByRole('textbox', { name: /gmail tools/ }), 'GMAIL_FETCH_EMAILS, GMAIL_SEND_EMAIL')
    await userEvent.click(screen.getByRole('button', { name: 'Send without asking' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ apps: { gmail: ['GMAIL_FETCH_EMAILS', 'GMAIL_SEND_EMAIL'] }, send_policy: 'auto' })
  })
})

describe('AgentForm', () => {
  it('creates an agent from the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: ['gmail'] })))
    render(<AgentForm />)
    const name = await screen.findByRole('textbox', { name: /Name/ })
    await userEvent.type(name, ' Reviewer ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect(apiMock.createAgent).toHaveBeenCalledWith({
      model: 'm1', name: 'Reviewer', instructions: '', metadata: {}, host_tools: null, multi_agent: { enabled: false }, reasoning: null, apps: null, skills: null, send_policy: 'ask',
    })
    expect(nav.push).toHaveBeenCalledWith('/agents')
  })
  it('opens a starter prefilled and refuses to save without a name', async () => {
    nav.params = new URLSearchParams('starter=planner')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: null })))
    render(<AgentForm />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Planner'))
    await userEvent.clear(screen.getByRole('textbox', { name: /Name/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Give the agent a name.')).toBeInTheDocument()
    expect(apiMock.createAgent).not.toHaveBeenCalled()
  })
})
