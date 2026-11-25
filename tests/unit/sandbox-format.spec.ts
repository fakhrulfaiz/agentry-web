import { describe, expect, it } from 'vitest'
import type { SandboxEnvironment } from '@/api/types'
import { canChatIn, environmentLook, environmentName, lastUsed, parseEnvLines, placeKindTitle, templateBody } from '@/ui/sandboxes/format'

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
    expect(environmentName(env())).toBe('Unnamed environment')
    const now = 10_000_000_000
    expect(lastUsed(null, now)).toBeNull()
    expect(lastUsed(now / 1000 - 300, now)).toBe('Used 5 min ago')
    expect(lastUsed(now / 1000 - 7200, now)).toBe('Used 2 h ago')
  })
})

describe('template editor body', () => {
  const form = { name: ' Data ', provider: 'sandbox', image: 'python:3.13', system: 'jq, curl', python: 'pandas\nrich', npm: '', setup: 'echo a\n\necho b', env: 'A=1\n# note\nB = two', network: false, cpus: '2', memoryGb: '4' }
  const all = ['image', 'packages', 'setup_commands', 'env', 'network', 'files', 'resources']

  it('builds every field the provider applies', () => {
    expect(templateBody(form, all)).toEqual({ body: {
      name: 'Data', provider: 'sandbox', image: 'python:3.13',
      packages: { system: ['jq', 'curl'], python: ['pandas', 'rich'], npm: [] },
      setup_commands: [{ command: 'echo a' }, { command: 'echo b' }],
      env: { A: '1', B: 'two' }, network: { access: 'disabled' }, resources: { cpus: 2, memory_mb: 4096 },
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
    expect(templateBody({ ...form, cpus: '100' }, all)).toMatchObject({ error: expect.stringContaining('CPU') })
  })
})

describe('environment menu label', () => {
  it('names the provider and state', async () => {
    const { environmentMenuLabel } = await import('@/ui/sandboxes/format')
    expect(environmentMenuLabel(env({ name: 'Data box', sandbox: { state: 'stopped' } }))).toBe('Data box (Isolated sandbox, stopped)')
  })
})

describe('session environment for a menu choice', () => {
  it('maps the default, an existing environment, an empty sandbox and a template sandbox', async () => {
    const { sessionEnvironment, NEW_SANDBOX } = await import('@/ui/sandboxes/format')
    expect(sessionEnvironment('')).toBeUndefined()
    expect(sessionEnvironment('env_1')).toEqual({ type: 'sandbox', environment_id: 'env_1' })
    expect(sessionEnvironment(NEW_SANDBOX)).toEqual({ type: 'openai_hosted', provider: 'sandbox' })
    expect(sessionEnvironment(`${NEW_SANDBOX}tpl_9`)).toEqual({ type: 'sandbox', template_id: 'tpl_9' })
  })
})

describe('places in the template body', () => {
  it('carries place and gpus only when the provider applies them', () => {
    const form = { name: 'T', provider: 'sandbox', image: '', system: '', python: '', npm: '', setup: '', env: '', network: true, cpus: '', memoryGb: '', place: 'gpu-box', gpus: 'all' }
    expect(templateBody(form, ['gpus'])).toEqual({ body: { name: 'T', provider: 'sandbox', place: 'gpu-box', gpus: 'all' } })
    expect(templateBody({ ...form, gpus: '0' }, ['gpus'])).toEqual({ body: { name: 'T', provider: 'sandbox', place: 'gpu-box' } })
    expect(templateBody(form, [])).toEqual({ body: { name: 'T', provider: 'sandbox', place: 'gpu-box' } })
  })
})

describe('place kinds in plain words', () => {
  it('names an SSH machine place and says it has no isolation', () => {
    expect(placeKindTitle('ssh-machine')).toBe('Machine over SSH (no isolation)')
    expect(placeKindTitle('docker-ssh')).toBe('Docker over SSH')
    expect(placeKindTitle('docker')).toBe('Docker on this server')
  })
})
