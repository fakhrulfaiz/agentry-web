// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { SessionArtifacts } from '@/ui/chat/SessionArtifacts'

describe('SessionArtifacts', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listSessionDeliverables').mockResolvedValue({ data: [] } as never)
  })

  it('re-reads the files each time the chat returns to idle', async () => {
    const { rerender } = render(<SessionArtifacts sessionId="s1" enabled idle />)
    expect(api.listSessionDeliverables).toHaveBeenCalledTimes(1)
    rerender(<SessionArtifacts sessionId="s1" enabled idle={false} />)
    expect(api.listSessionDeliverables).toHaveBeenCalledTimes(1)
    rerender(<SessionArtifacts sessionId="s1" enabled idle />)
    expect(api.listSessionDeliverables).toHaveBeenCalledTimes(2)
  })
})
