/** How a skill looks on its card: an icon and a hue from its kind, and a stable hue per name. */
import { BoltIcon, BookOpenIcon, BuildingLibraryIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import type { AgentSkill } from '@/api/types'
import type { HueName } from '@/ui/brand/palette'
import type { TileIcon } from '@/ui/shared/IconTile'

const LIBRARY_HUES: readonly HueName[] = ['violet', 'teal', 'pink', 'orange', 'green', 'amber']

export function skillVisual(skill: Pick<AgentSkill, 'name' | 'kind'>): { icon: TileIcon; hue: HueName } {
  if (skill.kind === 'bundled') return { icon: BuildingLibraryIcon, hue: 'slate' }
  if (skill.kind === 'builtin' || skill.kind === undefined) return { icon: BoltIcon, hue: 'blue' }
  let h = 0
  for (const c of skill.name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return { icon: skill.kind === 'private' ? LockClosedIcon : BookOpenIcon, hue: LIBRARY_HUES[h % LIBRARY_HUES.length]! }
}

/** CodeBlock language from a file name. */
export function languageOf(path: string): string {
  const ext = path.split('.').at(-1)?.toLowerCase() ?? ''
  const map: Record<string, string> = { sh: 'bash', bash: 'bash', py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', html: 'html', css: 'css', ps1: 'powershell', rb: 'ruby', toml: 'ini', txt: 'plaintext' }
  return map[ext] ?? 'plaintext'
}
