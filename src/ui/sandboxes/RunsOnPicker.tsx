'use client'

/**
 * "Runs on": where an environment or template runs, as plain-language choices
 * (This server, Isolated sandbox). A provider that is down is disabled and
 * says why. Used by the New environment and New template dialogs.
 */
import { HStack } from '@astryxdesign/core/HStack'
import { SelectableCard } from '@astryxdesign/core/SelectableCard'
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
  return (
    <VStack gap={2} role="radiogroup" aria-label="Runs on">
      <Text weight="medium">Runs on</Text>
      {providers.map((p) => {
        const down = p.available === false
        const places = !down && onPlaceChange ? (p.places ?? []) : []
        return (
          <VStack key={p.name} gap={2}>
          <SelectableCard
            label={providerTitle(p.name)}
            isSelected={value === p.name && places.length === 0}
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
          {places.map((pl) => {
            const gpus = gpuLabel(pl.gpus?.count)
            return (
              <VStack key={pl.id} gap={0} role="group" aria-label="Place">
                <SelectableCard
                  label={pl.name}
                  isSelected={value === p.name && place === pl.id}
                  onChange={(on) => on && onPlaceChange?.(p.name, pl.id)}
                  isDisabled={!pl.available}
                  padding={3}
                >
                  <VStack gap={0.5}>
                    <Text weight="medium">{pl.name}</Text>
                    <Text type="supporting" color="secondary">
                      {[placeKindTitle(pl.kind), pl.available ? 'Available' : (pl.reason ?? 'Not available right now.'), gpus].filter(Boolean).join(' · ')}
                    </Text>
                  </VStack>
                </SelectableCard>
              </VStack>
            )
          })}
          </VStack>
        )
      })}
    </VStack>
  )
}
