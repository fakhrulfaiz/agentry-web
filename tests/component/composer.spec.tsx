// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ATTACH_HINT, Composer, type ComposerSettings } from '@/ui/chat/Composer'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

describe('Composer', () => {
  const input = () => screen.getByRole('textbox', { name: 'Message input' })

  it('Enter sends, Shift+Enter inserts a newline', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn(async () => {})
    render(<Composer onSend={onSend} />)
    await user.click(input())
    await user.keyboard('first line{Shift>}{Enter}{/Shift}second line')
    expect(onSend).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('first line\nsecond line')
    await waitFor(() => expect(input()).toHaveTextContent(''))
  })

  it('does not send an empty message', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn(async () => {})
    render(<Composer onSend={onSend} />)
    await user.click(input())
    await user.keyboard('   {Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables the input while sending, then moves focus back to it', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    const onSend = vi.fn(() => pending.promise)
    render(<Composer onSend={onSend} />)
    await user.click(input())
    await user.keyboard('hello{Enter}')
    await waitFor(() => expect(input()).toHaveAttribute('contenteditable', 'false'))
    ;(document.activeElement as HTMLElement | null)?.blur()
    await act(async () => pending.resolve())
    await waitFor(() => expect(input()).toHaveAttribute('contenteditable', 'true'))
    await waitFor(() => expect(input()).toHaveFocus())
  })

  it('keeps the text when the send fails', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn(async () => {
      throw new Error('nope')
    })
    render(<Composer onSend={onSend} />)
    await user.click(input())
    await user.keyboard('keep me{Enter}')
    await waitFor(() => expect(input()).toHaveAttribute('contenteditable', 'true'))
    expect(input()).toHaveTextContent('keep me')
  })

  it('shows Stop while a turn runs', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const { rerender } = render(<Composer onSend={vi.fn(async () => {})} onStop={onStop} />)
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    rerender(<Composer onSend={vi.fn(async () => {})} onStop={onStop} isRunning />)
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('shows an inline error status', () => {
    render(<Composer onSend={vi.fn(async () => {})} status={{ type: 'error', message: 'Model not found' }} />)
    expect(screen.getByText('Model not found')).toBeInTheDocument()
  })
})
describe('Composer focus', () => {
  it('autofocus waits for the editor to be enabled and never lands on the attach button', async () => {
    const { rerender } = render(<Composer onSend={vi.fn(async () => {})} autoFocus isDisabled />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Attach files' })).not.toHaveFocus()
    rerender(<Composer onSend={vi.fn(async () => {})} autoFocus />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveFocus())
  })
})

describe('Composer footer and header', () => {
  const live = (over: Partial<ComposerSettings> = {}): ComposerSettings => ({
    models: ['mock-model', 'mock-large'],
    model: 'mock-model',
    onModelChange: vi.fn(),
    effort: 'auto',
    onEffortChange: vi.fn(),
    ...over,
  })

  it('a new chat picks the model from the offered list', async () => {
    const user = userEvent.setup()
    const settings = live()
    render(<Composer onSend={vi.fn(async () => {})} settings={settings} />)
    const model = screen.getByRole('combobox', { name: 'Model' })
    expect(model).toHaveTextContent('mock-model')
    await user.click(model)
    await user.click(await screen.findByRole('option', { name: 'mock-large' }))
    expect(settings.onModelChange).toHaveBeenCalledWith('mock-large')
  })

  it('a new chat picks the reasoning effort: Auto, Low, Medium or High', async () => {
    const user = userEvent.setup()
    const settings = live()
    render(<Composer onSend={vi.fn(async () => {})} settings={settings} />)
    const effort = screen.getByRole('combobox', { name: 'Reasoning effort' })
    expect(effort).toHaveTextContent('Auto')
    await user.click(effort)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Auto', 'Low', 'Medium', 'High'])
    await user.click(screen.getByRole('option', { name: 'High' }))
    expect(settings.onEffortChange).toHaveBeenCalledWith('high')
  })

  it('an open chat starts at its stored model and effort, and both menus are live', async () => {
    const user = userEvent.setup()
    const settings = live({ model: 'mock-large', effort: 'low', efforts: ['low', 'medium', 'high'] })
    render(<Composer onSend={vi.fn(async () => {})} settings={settings} />)
    const model = screen.getByRole('combobox', { name: 'Model' })
    const effort = screen.getByRole('combobox', { name: 'Reasoning effort' })
    expect(model).toHaveTextContent('mock-large')
    expect(effort).toHaveTextContent('Low')
    expect(isDisabled(model)).toBe(false)
    expect(isDisabled(effort)).toBe(false)
    // A stored effort cannot go back to Auto (Agentry has no value for it), so Auto is not offered.
    await user.click(effort)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Low', 'Medium', 'High'])
    await user.click(screen.getByRole('option', { name: 'High' }))
    expect(settings.onEffortChange).toHaveBeenCalledWith('high')
  })

  it('menus without a change handler show their value, disabled, with the reason', () => {
    const hint = 'Not available here'
    render(<Composer onSend={vi.fn(async () => {})} settings={{ models: null, model: 'mock-large', effort: 'low', hint }} />)
    const model = screen.getByRole('combobox', { name: 'Model' })
    const effort = screen.getByRole('combobox', { name: 'Reasoning effort' })
    expect(model).toHaveTextContent('mock-large')
    expect(effort).toHaveTextContent('Low')
    expect(isDisabled(model)).toBe(true)
    expect(isDisabled(effort)).toBe(true)
    expect(document.body).toHaveTextContent(hint)
  })

  it('the attach button is present but disabled, and says why', () => {
    render(<Composer onSend={vi.fn(async () => {})} />)
    const attach = screen.getByRole('button', { name: 'Attach files' })
    expect(isDisabled(attach)).toBe(true)
    expect(document.body).toHaveTextContent(ATTACH_HINT)
  })

  it('the attach button sits in the footer row, after the input and before the model menu', () => {
    const settings: ComposerSettings = { models: ['m1'], model: 'm1', onModelChange: vi.fn(), effort: 'auto', onEffortChange: vi.fn() }
    render(<Composer onSend={vi.fn(async () => {})} settings={settings} />)
    const attach = screen.getByRole('button', { name: 'Attach files' })
    const input = screen.getByRole('textbox', { name: 'Message input' })
    const model = screen.getByRole('combobox', { name: 'Model' })
    expect(input.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(attach.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('Composer slash commands', () => {
  // With commands the editor is a combobox (it owns the menu); without, a textbox.
  const input = () => screen.queryByRole('combobox', { name: 'Message input' }) ?? screen.getByRole('textbox', { name: 'Message input' })
  const COMMANDS = [
    { name: 'review', description: 'Review the open diff' },
    { name: 'plan', description: 'Write a plan' },
    { name: 'test' },
  ]
  const menu = () => screen.queryByRole('listbox', { name: 'Commands' })

  it('typing / at the start opens the commands; arrows and Enter insert one', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn(async () => {})
    render(<Composer onSend={onSend} commands={COMMANDS} />)
    await user.click(input())
    await user.keyboard('/')
    const list = await screen.findByRole('listbox', { name: 'Commands' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['/reviewReview the open diff', '/planWrite a plan', '/test'])
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(menu()).not.toBeInTheDocument())
    expect(onSend).not.toHaveBeenCalled()
    await user.keyboard('the API{Enter}')
    expect(onSend).toHaveBeenCalledWith('/plan the API')
  })

  it('filters by what follows the slash, and Escape closes the menu', async () => {
    const user = userEvent.setup()
    render(<Composer onSend={vi.fn(async () => {})} commands={COMMANDS} />)
    await user.click(input())
    await user.keyboard('/te')
    const list = await screen.findByRole('listbox', { name: 'Commands' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['/test'])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(menu()).not.toBeInTheDocument())
    expect(input()).toHaveTextContent('/te')
  })

  it('a slash later in the message opens nothing', async () => {
    const user = userEvent.setup()
    render(<Composer onSend={vi.fn(async () => {})} commands={COMMANDS} />)
    await user.click(input())
    await user.keyboard('and/or /')
    await act(async () => {})
    expect(menu()).not.toBeInTheDocument()
  })

  it('without commands there is no menu and /x is sent as text', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn(async () => {})
    render(<Composer onSend={onSend} />)
    await user.click(input())
    await user.keyboard('/compact')
    expect(menu()).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('/compact')
  })
})
