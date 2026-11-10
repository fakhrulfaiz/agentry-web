import { describe, expect, it } from 'vitest'
import { chooseEffort, chooseModel, parseSlashLine, AppCommandError, APP_COMMANDS } from '@/commands/app-commands'
import { buildSlashItems, slashSource } from '@/ui/chat/slash-menu'

const commands = [
  { name: 'compact', description: 'Compact the conversation history', accepts_attachments: false },
  { name: 'goal', description: 'Set the goal', input_hint: 'objective', accepts_attachments: false },
]
const skills = [{ name: 'plan', description: 'Write a plan' }, { name: 'compact', description: 'a skill with the same name' }, { name: 'model' }]

const names = (items: { label: string }[]) => items.map((i) => i.label)
const group = (item: { auxiliaryData?: { group: string } }) => item.auxiliaryData?.group

describe('buildSlashItems', () => {
  it('orders the groups Commands, App, Skills', () => {
    const items = buildSlashItems({ commands, app: APP_COMMANDS, skills, busy: false })
    expect([...new Set(items.map(group))]).toEqual(['Commands', 'App', 'Skills'])
  })

  it('shows a name once: the command wins over the app command, which wins over the skill', () => {
    const items = buildSlashItems({ commands, app: APP_COMMANDS, skills, busy: false })
    expect(items.filter((i) => i.label === 'compact').map(group)).toEqual(['Commands'])
    expect(items.filter((i) => i.label === 'model').map(group)).toEqual(['App'])
  })

  it('greys the commands out while a turn runs, not the other groups', () => {
    const items = buildSlashItems({ commands, app: APP_COMMANDS, skills, busy: true })
    expect(items.map((i) => [group(i), (i.auxiliaryData as { disabled: boolean }).disabled]).filter(([g]) => g === 'Commands').every(([, d]) => d)).toBe(true)
    expect(items.filter((i) => group(i) !== 'Commands').some((i) => (i.auxiliaryData as { disabled: boolean }).disabled)).toBe(false)
  })
})

describe('slashSource', () => {
  const source = slashSource(buildSlashItems({ commands, app: APP_COMMANDS, skills, busy: false }))

  it('returns every row for an empty query', async () => {
    expect(names(await source.search(''))).toEqual(['compact', 'goal', 'new', 'model', 'effort', 'clear', 'rename', 'plan'])
  })

  it('matches a name substring, keeping the group order', async () => {
    expect(names(await source.search('o'))).toEqual(['compact', 'goal', 'model', 'effort'])
    expect(names(await source.search('pl'))).toEqual(['plan'])
  })

  it('ranks a name prefix before description matches within a group', async () => {
    const found = await source.search('c')
    expect(names(found)).toEqual(['compact', 'clear', 'new', 'model', 'effort', 'rename'])
    expect(group(found[0])).toBe('Commands')
  })

  it('matches the description when the name does not', async () => {
    expect(names(await source.search('conversation'))).toEqual(['compact'])
  })

  it('finds nothing for an unknown query', async () => {
    expect(await source.search('zzz')).toEqual([])
  })
})

describe('app command helpers', () => {
  it('parses a slash line', () => {
    expect(parseSlashLine('/model deepseek-chat')).toEqual({ name: 'model', arg: 'deepseek-chat' })
    expect(parseSlashLine('  /new   hello there ')).toEqual({ name: 'new', arg: 'hello there' })
    expect(parseSlashLine('/clear')).toEqual({ name: 'clear', arg: '' })
    expect(parseSlashLine('hello /x')).toBeNull()
    expect(parseSlashLine('/Bad')).toBeNull()
  })

  it('validates a model and an effort', () => {
    expect(chooseModel('a', ['a', 'b'])).toBe('a')
    expect(() => chooseModel('c', ['a'])).toThrow(AppCommandError)
    expect(() => chooseModel('a', null)).toThrow(/loading/)
    expect(chooseEffort('HIGH', undefined)).toBe('high')
    expect(() => chooseEffort('auto', ['low', 'medium', 'high'])).toThrow(AppCommandError)
    expect(() => chooseEffort('max', undefined)).toThrow(/Unknown effort/)
  })
})
