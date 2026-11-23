import { describe, expect, it } from 'vitest'
import { isConnectLink } from '@/ui/chat/Markdown'

describe('isConnectLink', () => {
  it('accepts a Composio connect link', () => {
    expect(isConnectLink('https://connect.composio.dev/link/lk_abc123')).toBe(true)
  })
  it.each([
    ['other host', 'https://example.com/link/lk_abc'],
    ['http', 'http://connect.composio.dev/link/lk_abc'],
    ['lookalike host', 'https://connect.composio.dev.evil.com/link/lk_abc'],
    ['userinfo trick', 'https://connect.composio.dev@evil.com/link/lk_abc'],
    ['non-link path', 'https://connect.composio.dev/mcp'],
    ['relative', '/link/lk_abc'],
  ])('rejects %s', (_name, href) => {
    expect(isConnectLink(href)).toBe(false)
  })
})
