// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentForm } from '@/ui/agents/AgentForm'
import { connectedAppsMemo, hostToolsMemo, modelsMemo } from '@/agents/form-data'
import type { LibraryCandidate, LibrarySource } from '@/api/types'

const { apiMock, nav } = vi.hoisted(() => ({
  apiMock: {
    models: vi.fn(async () => ['m1', 'm2']),
    listHostTools: vi.fn(async () => [{ name: 'read_file' }, { name: 'grep' }, { name: 'shell' }]),
    createAgent: vi.fn(async () => ({ id: 'agent_9' })),
    updateAgent: vi.fn(),
    getAgent: vi.fn(async (id: string) => ({
      id, object: 'agent', name: 'Coordinator', model: 'm1', instructions: 'Coordinate work',
      description: 'Coordinates work', metadata: {}, tools: [], delegation: { mode: 'choose', agent_ids: ['agent_2'] },
    })),
    deleteAgent: vi.fn(),
    listAgents: vi.fn(async () => ({ object: 'list', data: [
      { id: 'agent_1', object: 'agent', name: 'Coordinator', model: 'm1', instructions: 'Coordinate work', description: 'Coordinates work', metadata: {}, tools: [] },
      { id: 'agent_2', object: 'agent', name: 'Reviewer', model: 'm1', instructions: 'Review PRs', description: 'Reviews pull requests', metadata: {}, tools: [] },
      { id: 'agent_3', object: 'agent', name: 'Writer', model: 'm1', instructions: 'Write docs', description: 'Writes docs', metadata: {}, tools: [] },
      { id: 'builtin_1', object: 'agent', built_in: true, name: 'Agentry', model: 'm1', instructions: 'Set up Agentry', description: 'Sets up your Agentry workspace', metadata: {}, tools: [] },
    ] })),
    listBuiltinLibrary: vi.fn(async () => ({ object: 'list', data: [
      { ref: 'Agentry:planner', source: 'Agentry', name: 'Planner', slug: 'planner', description: 'Plans work' },
    ] })),
    listLibrarySources: vi.fn(async () => ({ object: 'list' as const, data: [] as LibrarySource[] })),
    listLibrarySourceAgents: vi.fn(async () => ({ object: 'list' as const, data: [] as LibraryCandidate[] })),
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
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Sorts the inbox')
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
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Writes poems')
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
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Keeps the inbox tidy')
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
  it.each([
    ['On', true],
    ['Off', false],
    [/^Auto/, null],
  ] as const)('saves the web browser choice %s from the Tools tab', async (label, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Researcher')
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Researches topics')
    await userEvent.click(screen.getByRole('tab', { name: /^Tools/ }))
    expect(await screen.findByRole('radio', { name: /^Auto/ })).toBeChecked()
    expect(screen.getByText(/Runs in sandbox chats only/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: label }))
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect((apiMock.createAgent.mock.calls[0] as unknown[])[0]).toMatchObject({ browser: expected })
  })

  it('creates an agent from the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: ['gmail'] })))
    render(<AgentForm />)
    const name = await screen.findByRole('textbox', { name: /Name/ })
    await userEvent.type(name, ' Reviewer ')
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), ' Reviews pull requests ')
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect(apiMock.createAgent).toHaveBeenCalledWith({
      model: 'm1', name: 'Reviewer', description: 'Reviews pull requests', delegation: { mode: 'any', agent_ids: [] },
      instructions: '', metadata: { icon: expect.any(String), color: expect.any(String) }, host_tools: null, multi_agent: { enabled: false }, reasoning: null, apps: null, skills: null, send_policy: 'ask', browser: null,
    })
    expect(nav.push).toHaveBeenCalledWith('/agents')
  })
  it('says what is missing before saving', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    const checks = await screen.findByRole('list', { name: 'Before you save' })
    expect(within(checks).getByText('Name needed')).toBeInTheDocument()
    expect(within(checks).getByText('Description needed')).toBeInTheDocument()
    expect(within(checks).getByText('Add instructions')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'Planner')
    expect(within(checks).queryByText('Name needed')).toBeNull()
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Plans work')
    expect(within(checks).queryByText('Description needed')).toBeNull()
  })

  it('tool search narrows the list and Select all ticks only the matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Reader')
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Reads files')
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
    await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Does nothing')
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

describe('AgentForm description and delegation', () => {
  it('refuses to save without a one-line description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm />)
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Reviewer')
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(await screen.findByText(/Give the agent a one-line description/)).toBeInTheDocument()
    expect(apiMock.createAgent).not.toHaveBeenCalled()
  })

  it('lists saved agents with provenance and built-in Agentry, and saves chosen ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm agentId="agent_1" />)
    await userEvent.click(await screen.findByRole('tab', { name: /^Subagents/ }))
    await userEvent.click(screen.getByRole('switch', { name: /Let this agent delegate to subagents/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Choose' }))
    const reviewer = await screen.findByRole('checkbox', { name: 'Reviewer (Yours)' })
    expect(reviewer).toBeChecked()
    expect(screen.getByText('Reviews pull requests')).toBeInTheDocument()
    expect(screen.getByText('Agentry (Built in)')).toBeInTheDocument()
    expect(screen.getByText('Sets up your Agentry workspace')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Coordinator (Yours)' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Agentry (Built in)' })).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Writer (Yours)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(apiMock.updateAgent).toHaveBeenCalled())
    expect((apiMock.updateAgent.mock.calls[0] as unknown[])[1]).toMatchObject({ delegation: { mode: 'choose', agent_ids: ['agent_2', 'agent_3'] } })
  })

  it('shows Library entries as non-selectable rows and narrows the picker by search', async () => {
    apiMock.listLibrarySources.mockResolvedValueOnce({ object: 'list', data: [
      { id: 'src_1', object: 'library.source', label: 'ECC', url: 'https://example.com/agents', created_at: 1 },
    ] })
    apiMock.listLibrarySourceAgents.mockResolvedValueOnce({ object: 'list', data: [
      { name: 'security-reviewer', description: 'Reviews security', url: 'https://example.com/security.md' },
    ] })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm agentId="agent_1" />)
    await userEvent.click(await screen.findByRole('tab', { name: /^Subagents/ }))
    await userEvent.click(screen.getByRole('switch', { name: /Let this agent delegate to subagents/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Choose' }))
    expect(await screen.findByText('Planner (Library: Agentry)')).toBeInTheDocument()
    expect(await screen.findByText('Security reviewer (Library: ECC)')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Planner \(Library/ })).toBeNull()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search delegates' }), 'planner')
    expect(screen.queryByText(/Security reviewer/)).toBeNull()
  })

  it('hides the picker and clears ids when the mode is Off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: [] })))
    render(<AgentForm agentId="agent_1" />)
    await userEvent.click(await screen.findByRole('tab', { name: /^Subagents/ }))
    await userEvent.click(screen.getByRole('switch', { name: /Let this agent delegate to subagents/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Choose' }))
    expect(await screen.findByRole('checkbox', { name: 'Reviewer (Yours)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(screen.queryByRole('checkbox', { name: 'Reviewer (Yours)' })).toBeNull()
    expect(screen.queryByText('Agentry (Built in)')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(apiMock.updateAgent).toHaveBeenCalled())
    expect((apiMock.updateAgent.mock.calls[0] as unknown[])[1]).toMatchObject({ delegation: { mode: 'off', agent_ids: [] } })
  })
})
