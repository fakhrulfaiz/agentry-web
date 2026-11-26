import { describe, expect, it } from 'vitest'
import { notConnectedApp } from '@/chat/not-connected'

describe('notConnectedApp', () => {
  it('names the app of a failed direct tool whose account is not connected', () => {
    expect(notConnectedApp('gmail_search_emails', {}, '{"error":"No connected account found for toolkit gmail"}')).toBe('gmail')
    expect(notConnectedApp('googlecalendar_list_events', {}, '{"error":"USER_NOT_LOGGED_IN"}')).toBe('googlecalendar')
  })
  it('reads the app from the slug of a nested batch or a Composio tool name', () => {
    const args = { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE', arguments: {} }] }
    expect(notConnectedApp('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', args, 'Error: 401 Unauthorized: connected account expired', true)).toBe('slack')
    expect(notConnectedApp('mcp__composio__GITHUB_LIST_ISSUES', {}, 'No active connection for github')).toBe('github')
  })
  it('counts loose wording (401, unauthorized) only for a failed call', () => {
    expect(notConnectedApp('gmail_search_emails', {}, 'HTTP 401 unauthorized')).toBeNull()
    expect(notConnectedApp('gmail_search_emails', {}, 'HTTP 401 unauthorized', true)).toBe('gmail')
    expect(notConnectedApp('gmail_read_email', {}, 'Subject: invoice 4019 reconnect plan')).toBeNull()
  })
  it('stays quiet for other failures and other tools', () => {
    expect(notConnectedApp('gmail_search_emails', {}, '{"error":"rate limited"}')).toBeNull()
    expect(notConnectedApp('bash', {}, 'No connected account')).toBeNull()
    expect(notConnectedApp('gmail_search_emails', {}, undefined)).toBeNull()
    expect(notConnectedApp('gmail_search_emails', {}, '{"messages":[]}')).toBeNull()
  })
})
