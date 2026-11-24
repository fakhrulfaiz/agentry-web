import { describe, expect, it } from 'vitest'
import type { SandboxEnvironment } from '@/api/types'
import { canChatIn, environmentLook, environmentName, lastUsed, parseEnvLines, templateBody } from '@/ui/sandboxes/format'

const env = (over: Partial<SandboxEnvironment> = {}): SandboxEnvironment => ({ id: 'env_1', object: 'agent.environment', type: 'openai_hosted', status: 'connected', provider: 'sandbox', created_at: 1, ...over })

describe('sandbox environment format', () => {
  it('shows the live sandbox state over the status', () => {
    expect(environmentLook(env({ sandbox: { state: 'stopped' } }))).toEqual({ variant: 'neutral', text: 'Stopped' })
    expect(environmentLook(env({ sandbox: { state: 'unknown' } })).text).toBe('Unreachable')
    expect(environmentLook(env({ provider: 'local' })).text).toBe('Ready')
  })

  it('lets chats start in running or stopped sandboxes and ready local environments', () => {
    expect(canChatIn(env({ sandbox: { state: 'stopped' } }))).toBe(true)
    expect(canChatIn(env({ sandbox: { state: 'failed' } }))).toBe(false)
    expect(canChatIn(env({ sandbox: { state: 'gone' } }))).toBe(false)
    expect(canChatIn(env({ provider: 'local' }))).toBe(true)
    expect(canChatIn(env({ provider: 'local', status: 'failed' }))).toBe(false)
  })

  it('names and last use', () => {
    expect(environmentName(env({ name: 'Data box' }))).toBe('Data box')
    expect(environmentName(env())).toBe('env_1')
    const now = 10_000_000_000
    expect(lastUsed(null, now)).toBeNull()
    expect(lastUsed(now / 1000 - 300, now)).toBe('Used 5 min ago')
    expect(lastUsed(now / 1000 - 7200, now)).toBe('Used 2 h ago')
  })
})

describe('template editor body', () => {
  const form = { name: ' Data ', provider: 'sandbox', image: 'python:3.13', system: 'jq, curl', python: 'pandas\nrich', npm: '', setup: 'echo a\n\necho b', env: 'A=1\n# note\nB = two', network: false }
  const all = ['image', 'packages', 'setup_commands', 'env', 'network', 'files']

  it('builds every field the provider applies', () => {
    expect(templateBody(form, all)).toEqual({ body: {
      name: 'Data', provider: 'sandbox', image: 'python:3.13',
      packages: { system: ['jq', 'curl'], python: ['pandas', 'rich'], npm: [] },
      setup_commands: [{ command: 'echo a' }, { command: 'echo b' }],
      env: { A: '1', B: 'two' }, network: { access: 'disabled' },
    } })
  })

  it('leaves out fields the provider cannot apply', () => {
    expect(templateBody(form, ['files'])).toEqual({ body: { name: 'Data', provider: 'sandbox' } })
  })

  it('names what to fix', () => {
    expect(templateBody({ ...form, name: ' ' }, all)).toEqual({ error: 'Give the template a name.' })
    expect(templateBody({ ...form, env: '1BAD=x' }, all)).toMatchObject({ error: expect.stringContaining('1BAD=x') })
    expect(templateBody({ ...form, image: 'a b' }, all)).toMatchObject({ error: expect.stringContaining('one name') })
    expect(parseEnvLines('NOEQUALS')).toEqual({ bad: 'NOEQUALS' })
  })
})

describe('environment menu label', () => {
  it('names the provider and state', async () => {
    const { environmentMenuLabel } = await import('@/ui/sandboxes/format')
    expect(environmentMenuLabel(env({ name: 'Data box', sandbox: { state: 'stopped' } }))).toBe('Data box · sandbox · Stopped')
  })
})
