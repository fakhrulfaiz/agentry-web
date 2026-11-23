/** An agent's avatar tile: its icon on its colour. */
import { AGENT_ICONS, type AgentAvatar as Avatar } from '@/agents/avatar'
import { IconTile } from '@/ui/shared/IconTile'

export function AgentAvatar({ avatar, size = 'md', label }: { avatar: Avatar; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const entry = AGENT_ICONS[avatar.icon] ?? AGENT_ICONS.sparkles!
  return <IconTile icon={entry.icon} hue={avatar.color} size={size} {...(label ? { label } : {})} />
}
