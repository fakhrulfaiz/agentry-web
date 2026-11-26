'use client'

/**
 * "Runs on": where an environment or template runs, as plain-language choices
 * (This server, Isolated sandbox). A provider that is down is disabled and
 * says why. Used by the New environment and New template dialogs.
 */
import { HStack } from '@astryxdesign/core/HStack'
import { SelectableCard } from '@astryxdesign/core/SelectableCard'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { CubeTransparentIcon, ServerIcon } from '@heroicons/react/24/outline'
import type { SandboxProvider } from '@/api/types'
import { IconTile } from '@/ui/shared/IconTile'
import { gpuLabel, initialPlace, placeKindTitle, providerBlurb, providerTitle } from './format'

/** The provider a dialog starts on: the default one when it is available, else the first available. */
export function initialProvider(providers: SandboxProvider[]): string {
  const usable = providers.filter((p) => p.available !== false)
  return (usable.find((p) => p.default) ?? usable[0] ?? providers[0])?.name ?? ''
}

/** For templates: the available provider that applies the most template settings. */
export function richestProvider(providers: SandboxProvider[]): string {
  const usable = providers.filter((p) => p.available !== false)
  return [...usable].sort((a, b) => b.capabilities.templateFields.length - a.capabilities.templateFields.length)[0]?.name ?? initialProvider(providers)
}

/** The place a provider starts on (empty when it has none). */
export const defaultPlace = (provider: SandboxProvider | undefined): string => initialPlace(provider?.places)

export function RunsOnPicker({ providers, value, onChange, place = '', onPlaceChange }: {
  providers: SandboxProvider[]
  value: string
  onChange(name: string): void
  /** The chosen Agentry Sandbox place, when the provider has places. */
  place?: string
  onPlaceChange?(provider: string, place: string): void
}) {
  // The kinds (This server, Isolated sandbox) are the choice; a sandbox's places are a detail of it, so they sit in a dropdown under the chosen card.
  const chosen = providers.find((p) => p.name === value)
  const places = chosen && chosen.available !== false && onPlaceChange ? (chosen.places ?? []) : []
  return (
    <VStack gap={2} role="radiogroup" aria-label="Runs on">
      <Text weight="medium">Runs on</Text>
      {providers.map((p) => {
        const down = p.available === false
        return (
          <SelectableCard
            key={p.name}
            label={providerTitle(p.name)}
            isSelected={value === p.name}
            onChange={(on) => on && onChange(p.name)}
            isDisabled={down}
            padding={3}
          >
            <HStack gap={3} vAlign="start">
              <IconTile icon={p.name === 'local' ? ServerIcon : CubeTransparentIcon} hue={down ? 'slate' : p.name === 'local' ? 'teal' : 'blue'} size="sm" />
              <VStack gap={0.5}>
                <Text weight="medium">{providerTitle(p.name)}</Text>
                <Text type="supporting" color="secondary">{down ? (p.reason ?? 'Not available right now.') : providerBlurb(p.name)}</Text>
              </VStack>
            </HStack>
          </SelectableCard>
        )
      })}
      {places.length > 1 && (
        <Selector
          label="Where it runs"
          options={places.map((pl) => ({
            value: pl.id,
            label: pl.name,
            description: [placeKindTitle(pl.kind), pl.available ? gpuLabel(pl.gpus?.count) : (pl.reason ?? 'Not available right now.')].filter(Boolean).join(', '),
            disabled: !pl.available,
          }))}
          value={place || undefined}
          onChange={(v) => { if (v) onPlaceChange?.(value, v) }}
          width="100%"
        />
      )}
    </VStack>
  )
}
