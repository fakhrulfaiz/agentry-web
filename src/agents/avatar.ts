/**
 * Agent avatars: an icon and a colour from a curated set, saved as
 * `metadata.icon` / `metadata.color`. Agents without one (or with an unknown
 * value) get a stable choice derived from their id. The backend accepts the
 * same names (`AGENT_ICON_NAMES` in `@agentry/api`), so a chat can pick one.
 */
import {
  AcademicCapIcon, BriefcaseIcon, CalendarDaysIcon, ChartBarIcon, ChatBubbleLeftRightIcon, CodeBracketIcon, CpuChipIcon,
  DocumentTextIcon, EnvelopeIcon, GlobeAltIcon, LightBulbIcon, MagnifyingGlassIcon, PencilSquareIcon, PresentationChartBarIcon,
  ShieldCheckIcon, SparklesIcon, TableCellsIcon, WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'
import type { OAIAgent } from '@/api/types'
import type { HueName } from '@/ui/brand/palette'
import type { TileIcon } from '@/ui/shared/IconTile'

/** Icon name → icon and what it suits (shown as the picker tooltip). */
export const AGENT_ICONS: Record<string, { icon: TileIcon; label: string }> = {
  sparkles: { icon: SparklesIcon, label: 'General' },
  research: { icon: MagnifyingGlassIcon, label: 'Research' },
  writing: { icon: PencilSquareIcon, label: 'Writing' },
  code: { icon: CodeBracketIcon, label: 'Code' },
  mail: { icon: EnvelopeIcon, label: 'Email' },
  calendar: { icon: CalendarDaysIcon, label: 'Calendar' },
  data: { icon: ChartBarIcon, label: 'Data' },
  docs: { icon: DocumentTextIcon, label: 'Documents' },
  slides: { icon: PresentationChartBarIcon, label: 'Slides' },
  sheets: { icon: TableCellsIcon, label: 'Spreadsheets' },
  web: { icon: GlobeAltIcon, label: 'Web' },
  support: { icon: ChatBubbleLeftRightIcon, label: 'Support' },
  business: { icon: BriefcaseIcon, label: 'Business' },
  learning: { icon: AcademicCapIcon, label: 'Learning' },
  automation: { icon: CpuChipIcon, label: 'Automation' },
  review: { icon: ShieldCheckIcon, label: 'Review' },
  ideas: { icon: LightBulbIcon, label: 'Ideas' },
  tools: { icon: WrenchScrewdriverIcon, label: 'Tools' },
}

export const AGENT_COLORS: readonly HueName[] = ['blue', 'violet', 'green', 'orange', 'pink', 'teal', 'amber', 'red', 'slate']

export interface AgentAvatar {
  icon: string
  color: HueName
}

/** A small stable hash of a string. */
function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

/** The avatar a fresh key gets: icon and colour picked from `seed`. */
export function defaultAvatar(seed: string): AgentAvatar {
  const names = Object.keys(AGENT_ICONS)
  const h = hash(seed)
  return { icon: names[h % names.length]!, color: AGENT_COLORS[(h >>> 8) % AGENT_COLORS.length]! }
}

/** An agent's avatar from its metadata, each part falling back to the stable default. */
export function avatarOf(agent: Pick<OAIAgent, 'id' | 'metadata'>): AgentAvatar {
  const fallback = defaultAvatar(agent.id)
  const icon = agent.metadata?.icon
  const color = agent.metadata?.color as HueName | undefined
  return {
    icon: icon && icon in AGENT_ICONS ? icon : fallback.icon,
    color: color && AGENT_COLORS.includes(color) ? color : fallback.color,
  }
}
