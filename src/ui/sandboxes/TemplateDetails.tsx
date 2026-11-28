'use client'

/**
 * What a template sets up, in full: the image, each package list, starter files, internet and limits. The API
 * never returns setup commands, variables or file contents (they can hold secrets), so the dialog says so.
 */
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReactNode } from 'react'
import type { SandboxTemplate } from '@/api/types'
import { providerTitle } from './format'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack gap={0.5}>
      <Text type="supporting" color="secondary">{label}</Text>
      {children}
    </VStack>
  )
}

export function TemplateDetailsDialog({ template, onClose }: { template: SandboxTemplate | null; onClose(): void }) {
  const t = template
  const groups: [string, string[]][] = t
    ? [['System packages (apt)', t.packages.system], ['Python packages (pip)', t.packages.python], ['npm packages (global)', t.packages.npm]]
    : []
  const listed = groups.filter(([, items]) => items.length > 0)
  return (
    <Dialog isOpen={t !== null} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={480}>
      <DialogHeader
        title={t?.name || 'Template'}
        subtitle={t?.built_in ? 'Built in. It cannot be changed or deleted.' : 'A saved setup new sandboxes start from.'}
        onOpenChange={(open: boolean) => !open && onClose()}
      />
      {t && (
        <VStack gap={4} padding={4}>
          <Row label="Runs on"><Text>{t.place ? `${providerTitle(t.provider)}, ${t.place}` : providerTitle(t.provider)}</Text></Row>
          <Row label="Image"><Text>{t.image ?? 'The standard image'}</Text></Row>
          {listed.length === 0 && !t.image ? (
            <Row label="Software"><Text>Nothing extra: only what the image already has.</Text></Row>
          ) : (
            listed.map(([label, items]) => <Row key={label} label={label}><Text>{items.join(', ')}</Text></Row>)
          )}
          {t.files.length > 0 && <Row label="Starter files"><Text>{t.files.map((f) => f.path.replace(/^\/workspace\//u, '')).join(', ')}</Text></Row>}
          <Row label="Internet"><Text>{t.network.access === 'enabled' ? 'On (private networks are always blocked)' : t.network.access === 'disabled' ? 'Off' : 'Restricted'}</Text></Row>
          {t.resources && (t.resources.cpus !== undefined || t.resources.memory_mb !== undefined) && (
            <Row label="Limits">
              <Text>{[t.resources.cpus !== undefined ? `${t.resources.cpus} CPUs` : null, t.resources.memory_mb !== undefined ? `${t.resources.memory_mb} MB memory` : null].filter(Boolean).join(', ')}</Text>
            </Row>
          )}
          {!t.built_in && <Text type="supporting" color="secondary">Setup commands and variables are not shown here.</Text>}
        </VStack>
      )}
    </Dialog>
  )
}
