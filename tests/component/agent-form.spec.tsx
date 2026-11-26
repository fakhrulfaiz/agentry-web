// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentForm } from '@/ui/agents/AgentForm'
import { connectedAppsMemo, hostToolsMemo, modelsMemo } from '@/agents/form-data'

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
  for (const memo of [modelsMemo, hostToolsMemo, connectedAppsMemo]) memo.clear()
  apiMock.listHostTools.mockImplementation(async () => [{ name: 'read_file' }, { name: 'grep' }, { name: 'shell' }])
  cleanup()
  vi.clearAllMocks()
  nav.params = new URLSearchParams()
  vi.unstubAllGlobals()
})

describe('AgentForm avatar', () => {
  it('picking an icon and a colour saves them on the agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Inbox')
    await userEvent.click(screen.getByRole('button', { name: 'Change avatar' }))
    await userEvent.click(within(await screen.findByRole('group', { name: 'Agent icon' })).getByRole('button', { name: 'Email' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Agent colour' })).getByRole('button', { name: 'Teal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ metadata: { icon: 'mail', color: 'teal' } })
  })
})

describe('AgentForm skills and apps', () => {
  const LIB = `skill_${'a'.repeat(32)}`
  it('choosing skills saves every built-in plus the ticked library skill; office stays on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Poet')
    await userEvent.click(screen.getByRole('tab', { name: /^Skills/ }))
    await userEvent.click(await screen.findByRole('switch', { name: /Use all built-in skills/ }))
    const office = await screen.findByRole('checkbox', { name: /office-docx/ })
    expect(office).toBeChecked()
    expect(office).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('checkbox', { name: /haiku/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ skills: { builtin: ['composio', 'create-agent'], library: [LIB] } })
  })

  it('limits apps: Off drops an app and Choose tools saves the typed slugs; sending policy saves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: ['gmail', 'github'] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Mail')
    await userEvent.click(await screen.findByRole('tab', { name: /^Apps/ }))
    await userEvent.click(await screen.findByRole('switch', { name: /Limit this agent to specific apps/ }))
    await userEvent.click(within(screen.getByRole('group', { name: 'github access' })).getByRole('button', { name: 'Off' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'gmail access' })).getByRole('button', { name: 'Choose tools' }))
    await userEvent.type(screen.getByRole('textbox', { name: /gmail tools/ }), 'GMAIL_FETCH_EMAILS, GMAIL_SEND_EMAIL')
    await userEvent.click(screen.getByRole('button', { name: 'Send without asking' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ apps: { gmail: ['GMAIL_FETCH_EMAILS', 'GMAIL_SEND_EMAIL'] }, send_policy: 'auto' })
  })
})

describe('AgentForm', () => {
  it('turns on the web browser from the Tools tab', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Researcher')
    await userEvent.click(screen.getByRole('tab', { name: /^Tools/ }))
    const sw = await screen.findByRole('switch', { name: /Web browser/ })
    expect(sw).not.toBeChecked()
    expect(screen.getByText(/Runs in sandbox chats only/)).toBeInTheDocument()
    await userEvent.click(sw)
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ browser: true })
  })

  it('creates an agent from the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: ['gmail'] })))
    render(<AgentForm />)
    const name = await screen.findByRole('textbox', { name: /Name/ })
    await userEvent.type(name, ' Reviewer ')
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect(apiMock.createAgent).toHaveBeenCalledWith({
      model: 'm1', name: 'Reviewer', instructions: '', metadata: { icon: expect.any(String), color: expect.any(String) }, host_tools: null, multi_agent: { enabled: false }, reasoning: null, apps: null, skills: null, send_policy: 'ask', browser: false,
    })
    expect(nav.push).toHaveBeenCalledWith('/agents')
  })
  it('opens a starter prefilled and refuses to save without a name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: null })))
    render(<AgentForm starterId="planner" />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Planner'))
    await userEvent.clear(screen.getByRole('textbox', { name: /Name/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(await screen.findByText('Give the agent a name.')).toBeInTheDocument()
    expect(apiMock.createAgent).not.toHaveBeenCalled()
  })

  it('says what is missing before saving, and Start from fills the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    const checks = await screen.findByRole('list', { name: 'Before you save' })
    expect(within(checks).getByText('Name needed')).toBeInTheDocument()
    expect(within(checks).getByText('Add instructions')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start from' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Planner/ }))
    expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Planner')
    expect(within(checks).queryByText('Name needed')).toBeNull()
    expect(screen.getByRole('tab', { name: /^Tools/ })).toHaveTextContent(/\d/)
  })

  it('tool search narrows the list and Select all ticks only the matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Reader')
    await userEvent.click(screen.getByRole('switch', { name: /Allow every tool/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tools' }), 'read')
    expect(screen.queryByRole('checkbox', { name: /shell/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('1 of 3 tools allowed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ host_tools: { allow: ['read_file'] } })
  })
})

describe('AgentForm review fixes', () => {
  it('refuses to save with tools turned off and none chosen, instead of granting every tool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Nothing')
    await userEvent.click(screen.getByRole('switch', { name: /Allow every tool/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(within(screen.getByRole('list', { name: 'Before you save' })).getByText('Choose at least one tool')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(await screen.findByText(/Choose at least one tool, or allow every tool/)).toBeInTheDocument()
    expect(apiMock.createAgent).not.toHaveBeenCalled()
  })

  it('does not keep a failed tool list, so the next open asks again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    apiMock.listHostTools.mockRejectedValueOnce(new Error('down'))
    render(<AgentForm />)
    await screen.findByRole('textbox', { name: /Name/ })
    cleanup()
    render(<AgentForm />)
    await screen.findByRole('textbox', { name: /Name/ })
    expect(apiMock.listHostTools).toHaveBeenCalledTimes(2)
  })
})
