// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolCard } from '@/ui/chat/ToolCard'

afterEach(cleanup)

const view = {
  kind: 'tool' as const,
  id: 'f1',
  callId: 'c1',
  name: 'screenshot',
  args: {},
  status: 'done' as const,
  output: 'ok',
  images: [
    { type: 'output_image' as const, file_id: 'timg_s_ab12', filename: 'shot.png', media_type: 'image/png', bytes: 10 },
    { type: 'output_image' as const, media_type: 'image/png', bytes: 5 },
  ],
}

describe('tool images', () => {
  it('shows thumbnails through the BFF and opens the image larger', async () => {
    const user = userEvent.setup()
    render(<ToolCard view={view} />)
    await user.click(screen.getByRole('button', { name: /screenshot/ }))
    const list = await screen.findByTestId('tool-images')
    // The image without a file id has nothing to fetch and is skipped.
    expect(within(list).getAllByRole('img')).toHaveLength(1)
    expect(within(list).getByAltText('shot.png')).toHaveAttribute('src', '/api/agentry/agents/files/timg_s_ab12/content')
    await user.click(within(list).getByRole('button', { name: 'Open shot.png' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByAltText('shot.png')).toHaveAttribute('src', '/api/agentry/agents/files/timg_s_ab12/content')
  })

  it('shows no image list for a call without images', async () => {
    const user = userEvent.setup()
    render(<ToolCard view={{ ...view, images: undefined }} />)
    await user.click(screen.getByRole('button', { name: /screenshot/ }))
    expect(screen.queryByTestId('tool-images')).not.toBeInTheDocument()
  })
})
