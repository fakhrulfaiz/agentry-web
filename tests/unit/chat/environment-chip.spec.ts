import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import type { OAIEnvironmentConfig, SandboxEnvironment } from '@/api/types'
import { environmentChip, sandboxEnvironmentId } from '@/ui/chat/environment-chip'

const env = (overrides: Partial<SandboxEnvironment> = {}): SandboxEnvironment => ({
  id: 'env_1',
  object: 'agent.environment',
  type: 'sandbox',
  status: 'connected',
  provider: 'sandbox',
  created_at: 1,
  name: 'Data box',
  ...overrides,
})

const sandbox = (environment_id = 'env_1'): OAIEnvironmentConfig => ({ type: 'sandbox', environment_id })

describe('sandboxEnvironmentId', () => {
  it('returns the id only for a sandbox config with a non-empty string id', () => {
    expect(sandboxEnvironmentId(sandbox('env_1'))).toBe('env_1')
    expect(sandboxEnvironmentId({ type: 'local' })).toBeUndefined()
    expect(sandboxEnvironmentId({ type: 'none' })).toBeUndefined()
    expect(sandboxEnvironmentId(undefined)).toBeUndefined()
    expect(sandboxEnvironmentId({ type: 'sandbox', environment_id: '' })).toBeUndefined()
    expect(sandboxEnvironmentId({ type: 'sandbox', environment_id: 42 })).toBeUndefined()
  })
})

describe('environmentChip', () => {
  it('names the default server workspace for local, legacy and missing configs', () => {
    const server = { label: 'Server', variant: 'neutral', description: 'Default workspace on this server' }
    expect(environmentChip({ type: 'local' }, undefined)).toEqual(server)
    expect(environmentChip({ type: 'none' }, undefined)).toEqual(server)
    expect(environmentChip(undefined, undefined)).toEqual(server)
  })

  it('stays neutral while sandbox details load', () => {
    expect(environmentChip(sandbox(), undefined)).toEqual({
      label: 'Sandbox',
      variant: 'neutral',
      description: 'Loading environment details…',
    })
  })

  it('reports a sandbox that has been removed', () => {
    expect(environmentChip(sandbox(), undefined, new ApiError(404, 'not_found', 'gone'))).toEqual({
      label: 'Removed sandbox',
      variant: 'neutral',
      description: 'This chat’s sandbox no longer exists',
    })
  })

  it('falls back quietly when details cannot be loaded for another reason', () => {
    expect(environmentChip(sandbox('env_abcdefghijklmno'), undefined, new ApiError(503, 'unavailable', 'down'))).toEqual({
      label: 'Sandbox',
      variant: 'neutral',
      description: 'Could not load environment details (env_abcd…mno)',
    })
  })

  it('names a running sandbox and pairs it with a success dot', () => {
    expect(environmentChip(sandbox(), env({ sandbox: { state: 'running' } }))).toEqual({
      label: 'Data box · Running',
      variant: 'success',
      description: 'Isolated sandbox · Running',
    })
  })

  it('maps stopped, setting-up and failed sandbox states to their variants', () => {
    expect(environmentChip(sandbox(), env({ sandbox: { state: 'stopped' } }))).toMatchObject({
      label: 'Data box · Stopped',
      variant: 'neutral',
    })
    expect(environmentChip(sandbox(), env({ sandbox: { state: 'provisioning' } }))).toMatchObject({
      label: 'Data box · Setting up',
      variant: 'warning',
    })
    expect(environmentChip(sandbox(), env({ sandbox: { state: 'failed' } }))).toMatchObject({
      label: 'Data box · Failed',
      variant: 'error',
    })
  })

  it('falls back to the environment status when no live sandbox state is present', () => {
    expect(environmentChip(sandbox(), env())).toEqual({
      label: 'Data box · Ready',
      variant: 'success',
      description: 'Isolated sandbox · Ready',
    })
  })

  it('uses the provider in plain words in the description', () => {
    expect(environmentChip(sandbox(), env({ provider: 'local', sandbox: { state: 'running' } })).description).toBe('This server · Running')
  })
})
