import { describe, expect, it } from 'vitest'
import { setupProgressText } from '@/ui/sandboxes/format'

describe('setupProgressText', () => {
  it('says each stage in plain words', () => {
    const text = (stage: Parameters<typeof setupProgressText>[0] extends infer P ? (P extends { stage: infer S } ? S : never) : never) => setupProgressText({ stage, updated_at: 1 })
    expect(text('pulling_image')).toBe('Downloading the image…')
    expect(text('starting')).toBe('Starting…')
    expect(text('preparing')).toBe('Preparing the sandbox…')
    expect(text('installing_packages')).toBe('Installing packages…')
    expect(text('copying_runtime')).toBe('Copying the agent runtime…')
    expect(text('writing_files')).toBe('Adding files…')
    expect(text('running_setup')).toBe('Running setup…')
    expect(text('finishing')).toBe('Finishing…')
  })

  it('names the setup command and its place', () => {
    expect(setupProgressText({ stage: 'running_setup', step: 2, steps: 3, detail: 'npm install', updated_at: 1 })).toBe('Running setup (2 of 3): npm install')
    expect(setupProgressText({ stage: 'running_setup', step: 1, steps: 1, updated_at: 1 })).toBe('Running setup (1 of 1)…')
  })

  it('falls back for no progress or a stage it does not know', () => {
    expect(setupProgressText(undefined)).toBe('Setting up…')
    expect(setupProgressText({ stage: 'later_stage' as never, updated_at: 1 })).toBe('Setting up…')
  })
})
