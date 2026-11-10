// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Message } from '@/ui/chat/Message'

afterEach(cleanup)

describe('user message files', () => {
  it('shows an image thumbnail that opens the preview, and a file as a card', async () => {
    const user = userEvent.setup()
    render(
      <Message
        answer={async () => {}}
        view={{
          kind: 'user',
          id: 'item_1',
          text: 'look at these',
          files: [
            { id: 'file_img', name: 'red.png', bytes: 120, mediaType: 'image/png' },
            { id: 'file_txt', name: 'notes.txt', bytes: 5, mediaType: 'text/plain' },
          ],
        }}
      />,
    )
    expect(screen.getByText('look at these')).toBeInTheDocument()
    const card = screen.getByTestId('chat-artifact-card')
    expect(within(card).getByText('notes.txt')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Download notes.txt' })).toHaveAttribute('href', '/api/agentry/agents/files/file_txt/content?download=1')

    await user.click(screen.getByRole('button', { name: 'Preview red.png' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByAltText('red.png')).toHaveAttribute('src', '/api/agentry/agents/files/file_img/content')
    expect(within(dialog).queryByRole('button', { name: 'Open chat' })).not.toBeInTheDocument()
  })
})
