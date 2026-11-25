// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Message } from '@/ui/chat/Message'

afterEach(cleanup)

const view = { kind: 'user' as const, id: 'item_1', text: 'hello there' }

describe('user message actions', () => {
  it('offers Retry, Edit and Copy; Retry sends the same text', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Message answer={async () => {}} view={view} onSend={onSend} />)
    await user.hover(screen.getByText('hello there'))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onSend).toHaveBeenCalledWith('hello there')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('copies the text to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<Message answer={async () => {}} view={view} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('hello there')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('edits the text and sends it; Escape cancels', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Message answer={async () => {}} view={view} onSend={onSend} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit message' })
    await user.keyboard('{Escape}')
    expect(box).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByRole('textbox', { name: 'Edit message' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), 'hello again')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('hello again')
    expect(screen.getByText('hello there')).toBeInTheDocument()
  })

  it('hides Retry and Edit while a turn runs (no onSend)', () => {
    render(<Message answer={async () => {}} view={view} />)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
