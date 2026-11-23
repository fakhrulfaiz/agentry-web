'use client'

/** Pick an agent's icon and colour; the choice shows at once on the large tile beside the name. */
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { AGENT_COLORS, AGENT_ICONS } from '@/agents/avatar'
import { HUES, type HueName } from '@/ui/brand/palette'

const swatch = (hue: HueName) => (
  <span aria-hidden style={{ inlineSize: 14, blockSize: 14, borderRadius: 999, background: HUES[hue], display: 'inline-block' }} />
)

export function AvatarPicker({ icon, color, onChange }: { icon: string; color: HueName; onChange(next: { icon?: string; color?: HueName }): void }) {
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">Icon</Text>
      <HStack gap={1} wrap="wrap" role="group" aria-label="Agent icon">
        {Object.entries(AGENT_ICONS).map(([name, entry]) => (
          <ToggleButton key={name} label={entry.label} size="sm" isIconOnly icon={<Icon icon={entry.icon} size="sm" />} isPressed={icon === name} onPressedChange={() => onChange({ icon: name })} />
        ))}
      </HStack>
      <Text type="supporting" color="secondary">Colour</Text>
      <HStack gap={1} wrap="wrap" role="group" aria-label="Agent colour">
        {AGENT_COLORS.map((hue) => (
          <ToggleButton key={hue} label={hue.charAt(0).toUpperCase() + hue.slice(1)} size="sm" isIconOnly icon={swatch(hue)} isPressed={color === hue} onPressedChange={() => onChange({ color: hue })} />
        ))}
      </HStack>
    </VStack>
  )
}
