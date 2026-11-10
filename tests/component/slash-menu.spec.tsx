// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import type { AgentCommand } from '@/api/types'
import { AppCommandError, type AppCommandHandlers } from '@/commands/app-commands'
import { REFRESH_MS } from '@/commands/list-store'
import { refreshCommands, resetCommands, setCommands, useCommandList, useCommandsLoader } from '@/commands/commands-store'
import { refreshSkills, resetSkills, useSkillCommands, useSkillsLoader } from '@/skills/skills-store'
import { Composer } from '@/ui/chat/Composer'
import { CommandResult } from '@/ui/chat/CommandResult'

const DSH: AgentCommand[] = [
  { name: 'compact', description: 'Compact the conversation history', accepts_attachments: false },
  { name: 'goal', description: 'Set the goal', input_hint: 'objective', accepts_attachments: false },
]
const SKILLS = [{ name: 'plan', description: 'Write a plan' }, { name: 'compact', description: 'same name as a command' }]

const input = () => screen.queryByRole('combobox', { name: 'Message input' }) ?? screen.getByRole('textbox', { name: 'Message input' })
const menu = () => screen.queryByRole('listbox', { name: 'Commands' })
const texts = (list: HTMLElement) => within(list).getAllByRole('option').map((o) => o.textContent)

beforeEach(() => {
  resetSkills()
  resetCommands()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

interface Setup {
  onSend?: (text: string) => Promise<void>
  onRunCommand?: (name: string, input: string) => Promise<void>
  app?: AppCommandHandlers
  isRunning?: boolean
}
function setup({ onSend = vi.fn<(text: string) => Promise<void>>(async () => {}), onRunCommand = vi.fn<(name: string, input: string) => Promise<void>>(async () => {}), app, isRunning = false }: Setup = {}) {
  render(<Composer onSend={onSend} onRunCommand={onRunCommand} dshCommands={DSH} commands={SKILLS} appHandlers={app} isRunning={isRunning} />)
  return { onSend, onRunCommand }
}

describe('grouped / menu', () => {
  it('shows Commands, App and Skills in that order with their headers, and each name once', async () => {
    const user = userEvent.setup()
    setup({ app: { new: vi.fn(), rename: vi.fn() } })
    await user.click(input())
    await user.keyboard('/')
    const list = await screen.findByRole('listbox', { name: 'Commands' })
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Commands', 'App', 'Skills'])
    // The skill named like a command is hidden; the command wins.
    expect(texts(list)).toEqual([
      '/compactCompact the conversation history',
      '/goalSet the goalobjective',
      '/newStart a new chatmessage',
      '/renameRename this chat',
      '/planWrite a plan',
    ])
  })

  it('offers only the app commands the page has handlers for, and no menu without any entry', async () => {
    const user = userEvent.setup()
    render(<Composer onSend={vi.fn(async () => {})} appHandlers={{}} />)
    await user.click(input())
    await user.keyboard('/')
    await act(async () => {})
    expect(menu()).not.toBeInTheDocument()
  })

  it('filters across groups and hides the headers of empty groups', async () => {
    const user = userEvent.setup()
    setup({ app: { new: vi.fn() } })
    await user.click(input())
    await user.keyboard('/pl')
    const list = await screen.findByRole('listbox', { name: 'Commands' })
    expect(texts(list)).toEqual(['/planWrite a plan'])
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Skills'])
  })

  it('greys the commands out while a turn runs', async () => {
    const user = userEvent.setup()
    setup({ isRunning: true })
    await user.click(input())
    await user.keyboard('/')
    const list = await screen.findByRole('listbox', { name: 'Commands' })
    expect(texts(list).slice(0, 2)).toEqual(['/compactAvailable when the turn finishes', '/goalAvailable when the turn finishesobjective'])
    expect(texts(list)).toContain('/planWrite a plan')
  })
})

describe('submit routing', () => {
  it('runs a backend command with the text after its name instead of sending a message', async () => {
    const user = userEvent.setup()
    const { onSend, onRunCommand } = setup()
    await user.click(input())
    await user.keyboard('/goal ship it{Enter}')
    await waitFor(() => expect(onRunCommand).toHaveBeenCalledWith('goal', 'ship it'))
    expect(onSend).not.toHaveBeenCalled()
    await waitFor(() => expect(input()).toHaveTextContent(''))
  })

  it('choosing a command that takes no text runs it at once', async () => {
    const user = userEvent.setup()
    const { onRunCommand } = setup()
    await user.click(input())
    await user.keyboard('/comp')
    await screen.findByRole('listbox', { name: 'Commands' })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onRunCommand).toHaveBeenCalledWith('compact', ''))
  })

  it('choosing a command with a hint inserts it and waits for the text', async () => {
    const user = userEvent.setup()
    const { onRunCommand } = setup()
    await user.click(input())
    await user.keyboard('/go')
    await screen.findByRole('listbox', { name: 'Commands' })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(menu()).not.toBeInTheDocument())
    expect(onRunCommand).not.toHaveBeenCalled()
    expect(input()).toHaveTextContent('/goal')
  })

  it('refuses a command while a turn runs, keeping the text', async () => {
    const user = userEvent.setup()
    const { onRunCommand, onSend } = setup({ isRunning: true })
    await user.click(input())
    await user.keyboard('/compact{Escape}{Enter}')
    expect((await screen.findAllByText('Wait for the current turn to finish')).length).toBeGreaterThan(0)
    expect(onRunCommand).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
    expect(input()).toHaveTextContent('/compact')
  })

  it('shows a refused command as a notice and keeps the text', async () => {
    const user = userEvent.setup()
    const onRunCommand = vi.fn<(name: string, input: string) => Promise<void>>(async () => {
      throw new AppCommandError('That command is no longer available')
    })
    setup({ onRunCommand })
    await user.click(input())
    await user.keyboard('/compact{Enter}')
    expect((await screen.findAllByText('That command is no longer available')).length).toBeGreaterThan(0)
    expect(input()).toHaveTextContent('/compact')
  })

  it('runs an app command with its argument and shows the notice it returns', async () => {
    const user = userEvent.setup()
    const model = vi.fn(() => 'Model set to m2.')
    const { onSend, onRunCommand } = setup({ app: { model } })
    await user.click(input())
    await user.keyboard('/model m2{Enter}')
    await waitFor(() => expect(model).toHaveBeenCalledWith('m2', expect.objectContaining({ openMenu: expect.any(Function) })))
    expect((await screen.findAllByText('Model set to m2.')).length).toBeGreaterThan(0)
    expect(onSend).not.toHaveBeenCalled()
    expect(onRunCommand).not.toHaveBeenCalled()
  })

  it('keeps the text when an app command is refused', async () => {
    const user = userEvent.setup()
    setup({ app: { model: () => { throw new AppCommandError('Unknown model "x".') } } })
    await user.click(input())
    await user.keyboard('/model x{Enter}')
    expect((await screen.findAllByText('Unknown model "x".')).length).toBeGreaterThan(0)
    expect(input()).toHaveTextContent('/model x')
  })

  it('sends a skill, an unknown /name and an app command without a handler as a message', async () => {
    const user = userEvent.setup()
    const { onSend } = setup({ app: { new: vi.fn() } })
    await user.click(input())
    await user.keyboard('/plan the API{Enter}')
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('/plan the API'))
    await user.keyboard('/nope{Enter}')
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('/nope'))
    await user.keyboard('/rename{Enter}')
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('/rename'))
  })

  it('starts with the initial value', () => {
    render(<Composer onSend={vi.fn(async () => {})} initialValue="/office-docx " />)
    expect(input()).toHaveTextContent('/office-docx')
  })
})

describe('per-chat lists', () => {
  function Harness({ sessionId }: { sessionId?: string }) {
    useSkillsLoader(sessionId)
    useCommandsLoader(sessionId)
    const skills = useSkillCommands(sessionId)
    const commands = useCommandList(sessionId)
    return <p data-testid="lists">{`${skills.map((s) => s.name).join(',')}|${commands.map((c) => c.name).join(',')}`}</p>
  }

  it('passes the session id and reloads when the chat changes', async () => {
    const skills = vi.spyOn(api, 'listSkills').mockImplementation(async (id) => ({ object: 'list', data: [{ name: `skill-${id}` }] }))
    const commands = vi.spyOn(api, 'listCommands').mockImplementation(async (id) => ({ object: 'list', data: [{ name: `cmd-${id}`, description: '', accepts_attachments: false }] }))
    const { rerender } = render(<Harness sessionId="a" />)
    await waitFor(() => expect(screen.getByTestId('lists')).toHaveTextContent('skill-a|cmd-a'))
    rerender(<Harness sessionId="b" />)
    await waitFor(() => expect(screen.getByTestId('lists')).toHaveTextContent('skill-b|cmd-b'))
    expect(skills.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(commands.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    // Back to the first chat within the minute: its list is shown from the store, with no new request.
    rerender(<Harness sessionId="a" />)
    await waitFor(() => expect(screen.getByTestId('lists')).toHaveTextContent('skill-a|cmd-a'))
    expect(commands).toHaveBeenCalledTimes(2)
  })

  it('does not load commands without a chat, but loads the new-chat skills', async () => {
    const skills = vi.spyOn(api, 'listSkills').mockResolvedValue({ object: 'list', data: [{ name: 'plan' }] })
    const commands = vi.spyOn(api, 'listCommands')
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('lists')).toHaveTextContent('plan|'))
    expect(skills).toHaveBeenCalledWith(undefined)
    expect(commands).not.toHaveBeenCalled()
  })

  it('keeps a chat list after a failed refresh and throttles to once per minute', async () => {
    const spy = vi.spyOn(api, 'listCommands').mockResolvedValue({ object: 'list', data: [{ name: 'compact', description: '', accepts_attachments: false }] })
    await refreshCommands('a', 1_000)
    await refreshCommands('a', 1_000 + REFRESH_MS - 1)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRejectedValue(new Error('down'))
    await refreshCommands('a', 1_000 + REFRESH_MS)
    expect(spy).toHaveBeenCalledTimes(2)
    render(<Harness sessionId="a" />)
    expect(screen.getByTestId('lists')).toHaveTextContent('|compact')
  })

  it('keeps lists separate per chat', async () => {
    setCommands([{ name: 'only-a', description: '', accepts_attachments: false }], 'a')
    vi.spyOn(api, 'listCommands').mockRejectedValue(new Error('down'))
    vi.spyOn(api, 'listSkills').mockRejectedValue(new Error('down'))
    await refreshSkills('b')
    render(<Harness sessionId="b" />)
    await act(async () => {})
    expect(screen.getByTestId('lists')).toHaveTextContent('|')
    expect(screen.getByTestId('lists')).not.toHaveTextContent('only-a')
  })
})

describe('CommandResult', () => {
  it('renders the command line and its output, and marks a failure', () => {
    const { rerender } = render(<CommandResult view={{ kind: 'command', id: 'i', name: 'goal', args: 'ship it', ok: true, text: 'Goal set' }} />)
    expect(screen.getByText('/goal ship it')).toBeInTheDocument()
    expect(screen.getByText('Goal set')).toBeInTheDocument()
    rerender(<CommandResult view={{ kind: 'command', id: 'i', name: 'feedback', ok: false, text: 'Usage: /feedback <text>' }} />)
    expect(screen.getByText('/feedback')).toBeInTheDocument()
    expect(screen.getByText('Usage: /feedback <text>')).toBeInTheDocument()
  })
})
