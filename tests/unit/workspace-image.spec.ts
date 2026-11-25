import { describe, expect, it } from 'vitest'
import { workspaceImagePath } from '@/chat/workspace-image'

const ID = 'sess_f6bac60004a64bf9bad11af4884218d1'

describe('workspaceImagePath', () => {
  it('accepts relative paths and absolute paths inside this chat\'s folder', () => {
    expect(workspaceImagePath('chart.png', ID)).toBe('chart.png')
    expect(workspaceImagePath('./out/chart%20one.png', ID)).toBe('out/chart one.png')
    expect(workspaceImagePath(`/home/u/agentry-workspaces/dev/${ID}/demo/chart.png`, ID)).toBe('demo/chart.png')
    expect(workspaceImagePath(`file:///home/u/agentry-workspaces/dev/${ID}/chart.png`, ID)).toBe('chart.png')
    expect(workspaceImagePath('/home/u/agentry-workspaces/dev/sandbox-env_cebabb1372fe/demo/chart.png', ID)).toBe('demo/chart.png')
  })

  it('refuses remote, other-chat, escaping and hidden paths', () => {
    expect(workspaceImagePath('https://evil.example/a.png', ID)).toBeNull()
    expect(workspaceImagePath('//evil.example/a.png', ID)).toBeNull()
    expect(workspaceImagePath('data:image/png;base64,AAAA', ID)).toBeNull()
    expect(workspaceImagePath('/etc/passwd', ID)).toBeNull()
    expect(workspaceImagePath('/home/u/agentry-workspaces/dev/sess_other/a.png', ID)).toBeNull()
    expect(workspaceImagePath('../a.png', ID)).toBeNull()
    expect(workspaceImagePath('.secret/a.png', ID)).toBeNull()
  })
})
