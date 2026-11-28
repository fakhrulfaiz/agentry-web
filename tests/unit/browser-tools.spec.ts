import { describe, expect, it } from 'vitest'
import { browserAction, browserState, browserToolTitle, pageOf, shortUrl } from '@/chat/browser-tools'
import type { MessageView } from '@/chat/reducer'

type ToolView = Extract<MessageView, { kind: 'tool' }>
const tool = (name: string, args: unknown, over: Partial<ToolView> = {}): ToolView => ({ kind: 'tool', id: `${name}-${Math.random()}`, callId: 'c', name, args, status: 'done', ...over })
const NAV_OUTPUT = "### Ran Playwright code\n```js\nawait page.goto('https://example.com');\n```\n### Page\n- Page URL: https://example.com/\n- Page Title: Example Domain\n### Snapshot\n- [Snapshot](.browser/page.yml)"

describe('browserToolTitle', () => {
  it('recognises browser tools by their MCP name', () => {
    expect(browserAction('mcp__browser__browser_navigate')).toBe('navigate')
    expect(browserAction('browser.browser_click')).toBe('click')
    expect(browserAction('mcp__composio__browser_click')).toBeNull()
    expect(browserToolTitle('read_file', { path: 'x' })).toBeNull()
  })

  it.each([
    ['navigate', { url: 'https://example.com/docs?q=1' }, 'Opened example.com/docs?q=1'],
    ['navigate', '{"url":"https://example.com/"}', 'Opened example.com'],
    ['click', { element: 'Submit button', ref: 'e12' }, 'Clicked Submit button'],
    ['click', { element: 'Row', doubleClick: true }, 'Double-clicked Row'],
    ['click', {}, 'Clicked on the page'],
    ['type', { element: 'Search box', text: 'hello' }, 'Typed into Search box'],
    ['press_key', { key: 'Enter' }, 'Pressed Enter'],
    ['snapshot', {}, 'Read the page'],
    ['take_screenshot', {}, 'Took a screenshot'],
    ['navigate_back', {}, 'Went back'],
    ['fill_form', { fields: [] }, 'Filled in a form'],
    ['wait_for', { text: 'Done' }, 'Waited for “Done”'],
    ['something_new', {}, 'Browser: something new'],
  ])('%s %j reads "%s"', (action, args, title) => {
    expect(browserToolTitle(`mcp__browser__browser_${action}`, args)).toBe(title)
  })

  it('shortens URLs', () => {
    expect(shortUrl('https://www.example.com/')).toBe('www.example.com')
    expect(shortUrl('not a url')).toBe('not a url')
  })
})

describe('pageOf', () => {
  it('reads the page URL and title from a result, else a navigate call\'s url', () => {
    expect(pageOf(tool('mcp__browser__browser_click', {}, { output: NAV_OUTPUT }))).toEqual({ url: 'https://example.com/', title: 'Example Domain' })
    expect(pageOf(tool('mcp__browser__browser_navigate', { url: 'https://a.test/' }, { status: 'running' }))).toEqual({ url: 'https://a.test/' })
    expect(pageOf(tool('mcp__browser__browser_snapshot', {}, { output: 'nothing' }))).toBeNull()
  })

  it('reads JSON-shaped output too', () => {
    expect(pageOf(tool('mcp__browser__browser_click', {}, { output: [{ type: 'text', text: NAV_OUTPUT }] }))?.url).toBe('https://example.com/')
  })
})

describe('browserState', () => {
  it('follows the current page, latest screenshot and pages visited', () => {
    const shot = { type: 'output_image' as const, file_id: 'file_2', media_type: 'image/png', bytes: 10 }
    const items: MessageView[] = [
      tool('read_file', { path: 'a' }),
      tool('mcp__browser__browser_navigate', { url: 'https://example.com' }, { output: NAV_OUTPUT }),
      tool('mcp__browser__browser_take_screenshot', {}, { output: 'shot', images: [{ ...shot, file_id: 'file_1' }] }),
      tool('mcp__browser__browser_click', { element: 'More' }, { output: NAV_OUTPUT }),
      tool('mcp__browser__browser_navigate', { url: 'https://iana.org/' }, { output: '- Page URL: https://www.iana.org/\n- Page Title: IANA', images: [shot] }),
      tool('mcp__browser__browser_snapshot', {}, { status: 'running' }),
    ]
    const s = browserState(items)
    expect(s.calls).toBe(5)
    expect(s.running).toBe(true)
    expect(s.current).toEqual({ url: 'https://www.iana.org/', title: 'IANA' })
    expect(s.screenshot?.file_id).toBe('file_2')
    expect(s.visited.map((p) => p.url)).toEqual(['https://example.com/', 'https://www.iana.org/'])
  })

  it('is empty without browser calls', () => {
    expect(browserState([tool('read_file', {})])).toMatchObject({ calls: 0, current: null, screenshot: null, visited: [] })
  })
})
