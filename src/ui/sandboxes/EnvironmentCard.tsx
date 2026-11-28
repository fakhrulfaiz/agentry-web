'use client'

/**
 * One machine in the rack: name, a live status line, what it is, a row of facts
 * and its actions, built on the shared entity card (the name link covers the card).
 */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { Spinner } from '@astryxdesign/core/Spinner'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { Tooltip } from '@astryxdesign/core/Tooltip'
import { VStack } from '@astryxdesign/core/VStack'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import type { SandboxEnvironment, SandboxPlace, SandboxTemplate } from '@/api/types'
import { CardGrid, EntityCard } from '@/ui/cards/EntityCard'
import { canChatIn } from './format'
import { cardName, imageShort, statusLine, templateFacts } from './overview'

export interface EnvironmentCardProps {
  env: SandboxEnvironment
  template?: SandboxTemplate
  places: SandboxPlace[]
  chats: number | null
  busy: boolean
  onRename(): void
  onDelete(): void
  onLifecycle(action: 'start' | 'stop'): void
}

export function EnvironmentCard({ env, template, places, chats, busy, onRename, onDelete, onLifecycle }: EnvironmentCardProps) {
  const router = useRouter()
  const name = cardName(env)
  const line = statusLine(env, places)
  const state = env.sandbox?.state
  const live = state === 'running'
  const stopped = state === 'stopped'
  const facts = templateFacts(template)
  const image = env.sandbox?.image ?? template?.image
  const gpus = env.sandbox?.gpus ?? template?.gpus
  const gpuText = gpus === 'all' ? 'All GPUs' : typeof gpus === 'number' && gpus > 0 ? `${gpus} ${gpus === 1 ? 'GPU' : 'GPUs'}` : null
  const origin = env.template_id ? (template?.name || 'Deleted template') : 'Custom'
  const open = `/sandboxes/${env.id}`
  const menu = [
    { label: 'Open', onClick: () => router.push(open) },
    { label: 'Rename', onClick: onRename },
    ...(stopped ? [{ label: 'Start', onClick: () => onLifecycle('start') }] : []),
    ...(live ? [{ label: 'Stop', onClick: () => onLifecycle('stop') }] : []),
    { type: 'divider' as const },
    { label: 'Delete', variant: 'destructive' as const, onClick: onDelete },
  ]
  const hasFacts = image || facts.cpu || facts.memory || gpuText || facts.internet || (chats ?? 0) > 0
  return (
    <EntityCard
      href={open}
      title={name}
      trailing={<MoreMenu label={`More options for ${name}`} size="sm" alignment="end" isDisabled={busy} items={menu} />}
      footer={
        <>
          {canChatIn(env) && <Button label="New chat here" size="sm" variant="primary" onClick={() => router.push(`/?environment=${encodeURIComponent(env.id)}`)} />}
          {stopped && <Button label="Start" size="sm" isLoading={busy} isDisabled={busy} onClick={() => onLifecycle('start')} />}
          {live && <Button label="Stop" size="sm" isLoading={busy} isDisabled={busy} onClick={() => onLifecycle('stop')} />}
        </>
      }
    >
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          {busy || line.busy ? <Spinner size="sm" /> : <StatusDot variant={line.variant} label={line.variant === 'success' ? 'Running' : line.variant === 'error' ? 'Failed' : 'Not running'} />}
          <Text type="supporting" weight={live || line.busy || line.variant === 'error' ? 'medium' : 'normal'} color={live || line.busy ? 'primary' : 'secondary'} maxLines={2}>{line.text}</Text>
        </HStack>
        <Text type="supporting" color="secondary" maxLines={1}>{origin}</Text>
        {hasFacts && (
          <HStack gap={4} vAlign="center" wrap="wrap">
            {image && <Tooltip content={image}><Text type="code" color="secondary" maxLines={1}>{imageShort(image)}</Text></Tooltip>}
            {[facts.cpu, facts.memory, gpuText, facts.internet, (chats ?? 0) > 0 ? `${chats} ${chats === 1 ? 'chat' : 'chats'}` : null]
              .filter((f): f is string => Boolean(f))
              .map((f) => <Text key={f} type="supporting" color="secondary">{f}</Text>)}
          </HStack>
        )}
      </VStack>
    </EntityCard>
  )
}

/** A section of the list: a small heading with its count, then a grid of cards. */
export function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <VStack gap={2} role="group" aria-label={title}>
      <HStack gap={2} vAlign="center">
        <Text type="label" weight="medium">{title}</Text>
        <Text type="supporting" color="secondary">{count}</Text>
      </HStack>
      <CardGrid label={title}>{children}</CardGrid>
    </VStack>
  )
}
