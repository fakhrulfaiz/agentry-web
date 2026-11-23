'use client'

/**
 * The Sandboxes page: Environments (where agents run, with status and files),
 * Templates (reusable setups) and Providers (what each backend can do).
 */
import { CpuChipIcon, ServerStackIcon, Square3Stack3DIcon } from '@heroicons/react/24/outline'
import { IconTile } from '@/ui/shared/IconTile'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { FileInput } from '@astryxdesign/core/FileInput'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { CircleStackIcon, CommandLineIcon, DocumentDuplicateIcon, ExclamationTriangleIcon, FolderOpenIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { SandboxEnvironment, SandboxProvider, SandboxRuntimes, SandboxTemplate } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { CardGrid, EntityCard, Fact } from '@/ui/cards/EntityCard'
import { formatBytes, providerAbilities, shortDate, statusLook, templateSummary, toBase64 } from './format'

const COLUMN_WIDTH = 880
type View = 'environments' | 'templates' | 'providers'
const DEFAULT_PROVIDER = ''

function Meta({ icon, children }: { icon: typeof FolderOpenIcon; children: string }) {
  return <Fact icon={<Icon icon={icon} size="sm" color="secondary" />}>{children}</Fact>
}

/** Provider options: the default first, then the registered names. */
function providerOptions(providers: SandboxProvider[]) {
  const standard = providers.find((p) => p.default)
  return [
    { value: DEFAULT_PROVIDER, label: standard ? `Default (${standard.name})` : 'Default' },
    ...providers.map((p) => ({ value: p.name, label: p.name })),
  ]
}

function NewEnvironmentDialog({
  isOpen, onClose, templates, providers, onCreated,
}: { isOpen: boolean; onClose(): void; templates: SandboxTemplate[]; providers: SandboxProvider[]; onCreated(): void }) {
  const [templateId, setTemplateId] = useState('')
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = templates.find((t) => t.id === templateId)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      await api.createSandboxEnvironment({ ...(templateId ? { templateId } : {}), ...(provider ? { provider } : {}) })
      onCreated()
      onClose()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not create the environment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={460}>
      <DialogHeader title="New environment" subtitle="A workspace an agent can run in." onOpenChange={(open: boolean) => !open && onClose()} />
      <VStack gap={3} padding={4}>
        {error !== null && <Banner status="error" title={error} />}
        <Selector
          label="Template"
          description="Start from a saved setup, or leave it empty."
          options={[{ value: '', label: 'No template' }, ...templates.map((t) => ({ value: t.id, label: t.name || t.id }))]}
          value={templateId}
          onChange={setTemplateId}
        />
        {providers.length > 1 && (
          <Selector label="Provider" description="Where it runs. The template's provider is used when you pick the default." options={providerOptions(providers)} value={provider} onChange={setProvider} />
        )}
        {chosen && chosen.unsupported_fields.length > 0 && (
          <Banner status="warning" title={`This template sets ${chosen.unsupported_fields.join(', ')}, which ${chosen.provider} cannot apply, so it will not start.`} />
        )}
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" onClick={onClose} />
          <Button label="Create environment" variant="primary" isLoading={busy} onClick={() => void create()} />
        </HStack>
      </VStack>
    </Dialog>
  )
}

const MAX_STARTER_FILE = 1024 * 1024
const MAX_STARTER_FILES = 20

function NewTemplateDialog({
  isOpen, onClose, providers, onCreated,
}: { isOpen: boolean; onClose(): void; providers: SandboxProvider[]; onCreated(): void }) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const [starters, setStarters] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = providers.find((p) => (provider ? p.name === provider : p.default))
  const cannotHoldFiles = target !== undefined && !target.capabilities.templateFields.includes('files')

  function pick(value: File | File[] | null) {
    const files = value === null ? [] : Array.isArray(value) ? value : [value]
    setStarters(files.slice(0, MAX_STARTER_FILES))
  }

  async function create() {
    if (name.trim() === '') return setError('Give the template a name.')
    const tooBig = starters.find((f) => f.size > MAX_STARTER_FILE)
    if (tooBig) return setError(`${tooBig.name} is larger than ${formatBytes(MAX_STARTER_FILE)}.`)
    setBusy(true)
    setError(null)
    try {
      await api.createSandboxTemplate({
        name: name.trim(),
        ...(provider ? { provider } : {}),
        ...(starters.length > 0
          ? { files: await Promise.all(starters.map(async (f) => ({ type: 'inline' as const, path: `/workspace/${f.name}`, data: await toBase64(f) }))) }
          : {}),
      })
      onCreated()
      onClose()
      setName('')
      setStarters([])
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not save the template.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={520}>
      <DialogHeader title="New template" subtitle="Starter files every new environment begins with." onOpenChange={(open: boolean) => !open && onClose()} />
      <VStack gap={3} padding={4}>
        {error !== null && <Banner status="error" title={error} />}
        <TextInput label="Name" value={name} onChange={setName} />
        {providers.length > 1 && <Selector label="Provider" options={providerOptions(providers)} value={provider} onChange={setProvider} />}
        <FileInput
          label="Starter files"
          isOptional
          isMultiple
          description={`Copied into /workspace. Up to ${MAX_STARTER_FILES} files of ${formatBytes(MAX_STARTER_FILE)} each.`}
          value={starters}
          onChange={pick}
          isDisabled={cannotHoldFiles}
          disabledMessage={cannotHoldFiles ? `${target?.name} cannot hold starter files.` : undefined}
        />
        <Text type="supporting" color="secondary">
          Node, Python and the Office tools are already available to every agent; you do not need to install them here.
        </Text>
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" onClick={onClose} />
          <Button label="Save template" variant="primary" isLoading={busy} onClick={() => void create()} />
        </HStack>
      </VStack>
    </Dialog>
  )
}

/** What the host bundles for every agent, in plain terms. */
function RuntimesCard({ runtimes }: { runtimes: SandboxRuntimes | null }) {
  if (runtimes === null || !runtimes.available) {
    return (
      <EntityCard title="Bundled runtimes" footer={<Meta icon={CommandLineIcon}>Not installed on this server</Meta>}>
        <Text type="supporting" color="secondary">Agents use whatever Node and Python the server itself has.</Text>
      </EntityCard>
    )
  }
  const packages = Object.keys(runtimes.python_packages ?? {})
  return (
    <EntityCard
      title="Bundled runtimes"
      leading={<IconTile icon={CommandLineIcon} hue="teal" />}
      trailing={<Text type="supporting" color="secondary">Shared by every chat</Text>}
      footer={
        <>
          {runtimes.node && <Meta icon={CommandLineIcon}>{`Node ${runtimes.node}`}</Meta>}
          {runtimes.python && <Meta icon={CommandLineIcon}>{`Python ${runtimes.python}`}</Meta>}
          {runtimes.pnpm && <Meta icon={CommandLineIcon}>{`pnpm ${runtimes.pnpm}`}</Meta>}
        </>
      }
    >
      <Text type="supporting" color="secondary">
        Agents pick Node or Python themselves, and the Office tools (Word, PowerPoint, Excel, PDF) use the same bundle.
        {packages.length > 0 ? ` Python includes ${packages.slice(0, 6).join(', ')}${packages.length > 6 ? ` and ${packages.length - 6} more` : ''}.` : ''}
      </Text>
    </EntityCard>
  )
}

export function SandboxesPage() {
  const [view, setView] = useState<View>('environments')
  const [environments, setEnvironments] = useState<SandboxEnvironment[] | null>(null)
  const [templates, setTemplates] = useState<SandboxTemplate[] | null>(null)
  const [providers, setProviders] = useState<SandboxProvider[] | null>(null)
  const [runtimes, setRuntimes] = useState<SandboxRuntimes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'environment' | 'template' | null>(null)
  const [removing, setRemoving] = useState<SandboxTemplate | null>(null)

  const load = useCallback(async () => {
    try {
      const [envs, tpls, provs] = await Promise.all([api.listSandboxEnvironments(), api.listSandboxTemplates(), api.listSandboxProviders()])
      setEnvironments(envs.data)
      setTemplates(tpls.data)
      setProviders(provs.data)
      setError(null)
      // The runtimes card is informative; an older backend without the endpoint just shows the fallback.
      api.listSandboxRuntimes().then(setRuntimes, () => undefined)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not load sandboxes.')
      setEnvironments((cur) => cur ?? [])
      setTemplates((cur) => cur ?? [])
      setProviders((cur) => cur ?? [])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const loading = environments === null || templates === null || providers === null
  const templateName = (id?: string) => (id ? templates?.find((t) => t.id === id)?.name || 'Deleted template' : null)

  async function removeTemplate() {
    if (!removing) return
    try {
      await api.deleteSandboxTemplate(removing.id)
      setRemoving(null)
      void load()
    } catch (err) {
      setRemoving(null)
      setError(err instanceof ApiError ? err.message : 'Could not delete the template.')
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
      <VStack gap={4}>
        <Heading level={1} type="display-2">Sandboxes</Heading>
        <HStack gap={3} vAlign="center">
          <StackItem size="fill">
            <HStack gap={1} vAlign="center" role="group" aria-label="Sandboxes view">
              <ToggleButton label="Environments" size="sm" isPressed={view === 'environments'} onPressedChange={() => setView('environments')} />
              <ToggleButton label="Templates" size="sm" isPressed={view === 'templates'} onPressedChange={() => setView('templates')} />
              <ToggleButton label="Runtimes" size="sm" isPressed={view === 'providers'} onPressedChange={() => setView('providers')} />
            </HStack>
          </StackItem>
          {view === 'environments' && <Button label="New environment" variant="primary" onClick={() => setDialog('environment')} />}
          {view === 'templates' && <Button label="New template" variant="primary" onClick={() => setDialog('template')} />}
        </HStack>
        {error !== null && <Banner status="error" title={error} endContent={<Button label="Retry" size="sm" onClick={() => void load()} />} />}

        {loading ? (
          <Skeleton height={160} />
        ) : view === 'environments' ? (
          environments.length === 0 ? (
            <EmptyState
              icon={<Icon icon={CircleStackIcon} size="lg" color="secondary" />}
              title="No environments yet."
              description="An environment is a workspace an agent runs in, with its own files. Create one, then pick it when you start a chat."
              actions={<Button label="New environment" onClick={() => setDialog('environment')} />}
            />
          ) : (
            <CardGrid label="Environments">
              {environments.map((env) => {
                const look = statusLook(env.status)
                const from = templateName(env.template_id)
                return (
                  <EntityCard
                    key={env.id}
                    href={`/sandboxes/${env.id}`}
                    title={env.id}
                    leading={<IconTile icon={ServerStackIcon} hue={env.status === 'connected' ? 'green' : 'slate'} />}
                    trailing={<HStack gap={2} vAlign="center"><StatusDot variant={look.variant} label={look.text} /><Text type="supporting" color="secondary">{look.text}</Text></HStack>}
                    footer={
                      <>
                        <Meta icon={CommandLineIcon}>{env.provider}</Meta>
                        <Meta icon={DocumentDuplicateIcon}>{from ?? 'No template'}</Meta>
                        <Meta icon={FolderOpenIcon}>{shortDate(env.created_at)}</Meta>
                      </>
                    }
                  >
                    {env.error ? <Text type="supporting" color="secondary" maxLines={2}>{env.error}</Text> : null}
                  </EntityCard>
                )
              })}
            </CardGrid>
          )
        ) : view === 'templates' ? (
          templates.length === 0 ? (
            <EmptyState
              icon={<Icon icon={DocumentDuplicateIcon} size="lg" color="secondary" />}
              title="No templates yet."
              description="A template saves starter files so every new environment begins with the same workspace."
              actions={<Button label="New template" onClick={() => setDialog('template')} />}
            />
          ) : (
            <CardGrid label="Templates">
              {templates.map((tpl) => (
                <EntityCard
                  key={tpl.id}
                  title={tpl.name || 'Untitled template'}
                  leading={<IconTile icon={Square3Stack3DIcon} hue="violet" />}
                  trailing={<IconButton label={`Delete ${tpl.name || 'template'}`} size="sm" variant="ghost" icon={<Icon icon={TrashIcon} />} onClick={() => setRemoving(tpl)} />}
                  footer={
                    <>
                      <Meta icon={CommandLineIcon}>{tpl.provider}</Meta>
                      {tpl.unsupported_fields.length > 0 && (
                        <Fact icon={<Icon icon={ExclamationTriangleIcon} size="sm" color="warning" />}>
                          {`${tpl.provider} cannot apply ${tpl.unsupported_fields.join(', ')}`}
                        </Fact>
                      )}
                    </>
                  }
                >
                  <Text type="supporting" color="secondary">{templateSummary(tpl)}</Text>
                </EntityCard>
              ))}
            </CardGrid>
          )
        ) : providers.length === 0 ? (
          <EmptyState icon={<Icon icon={CommandLineIcon} size="lg" color="secondary" />} title="No providers registered." description="The server has no sandbox provider configured." />
        ) : (
          <CardGrid label="Providers and runtimes">
            <RuntimesCard runtimes={runtimes} />
            {providers.map((p) => (
              <EntityCard
                key={p.name}
                title={p.name}
                leading={<IconTile icon={CpuChipIcon} hue="blue" />}
                trailing={p.default ? <Text type="supporting" color="secondary">Default</Text> : undefined}
                footer={providerAbilities(p).map((ability) => <Meta key={ability} icon={CommandLineIcon}>{ability}</Meta>)}
              >
                <Text type="supporting" color="secondary">
                  {p.capabilities.templateFields.length > 0 ? `Applies ${p.capabilities.templateFields.join(', ')} from templates.` : 'Applies no template fields.'}
                </Text>
                {!p.capabilities.exec && <Text type="supporting" color="secondary">Cannot run an agent&apos;s tools, so chats cannot use it yet.</Text>}
              </EntityCard>
            ))}
          </CardGrid>
        )}
      </VStack>

      <NewEnvironmentDialog isOpen={dialog === 'environment'} onClose={() => setDialog(null)} templates={templates ?? []} providers={providers ?? []} onCreated={() => void load()} />
      <NewTemplateDialog isOpen={dialog === 'template'} onClose={() => setDialog(null)} providers={providers ?? []} onCreated={() => void load()} />
      <AlertDialog
        isOpen={removing !== null}
        onOpenChange={(open: boolean) => !open && setRemoving(null)}
        title="Delete this template?"
        description="Environments already created from it keep running. You cannot start new ones from it."
        actionLabel="Delete template"
        onAction={() => void removeTemplate()}
      />
    </div>
  )
}
