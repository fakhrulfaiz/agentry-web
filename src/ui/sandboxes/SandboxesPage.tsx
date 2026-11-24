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
import { Switch } from '@astryxdesign/core/Switch'
import { TextArea } from '@astryxdesign/core/TextArea'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { CircleStackIcon, ClockIcon, CommandLineIcon, CubeIcon, DocumentDuplicateIcon, ExclamationTriangleIcon, FolderOpenIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { SandboxEnvironment, SandboxProvider, SandboxRuntimes, SandboxTemplate } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { CardGrid, EntityCard, Fact } from '@/ui/cards/EntityCard'
import { environmentLook, environmentName, formatBytes, lastUsed, providerAbilities, shortDate, templateBody, templateSummary, toBase64, type TemplateForm } from './format'

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
    ...providers.map((p) => ({
      value: p.name,
      label: p.name,
      ...(p.available === false ? { disabled: true, description: p.reason ?? 'Not available right now' } : p.version ? { description: `Version ${p.version}` } : {}),
    })),
  ]
}

function NewEnvironmentDialog({
  isOpen, onClose, templates, providers, onCreated,
}: { isOpen: boolean; onClose(): void; templates: SandboxTemplate[]; providers: SandboxProvider[]; onCreated(): void }) {
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = templates.find((t) => t.id === templateId)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await api.createSandboxEnvironment({ ...(templateId ? { templateId } : {}), ...(provider ? { provider } : {}), ...(name.trim() ? { name: name.trim() } : {}) })
      // A refused sandbox (a limit, a failed setup) is recorded as failed: show why here instead of closing.
      if (created.status === 'failed' && created.error) {
        onCreated()
        return setError(created.error)
      }
      onCreated()
      onClose()
      setName('')
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
        <TextInput label="Name" isOptional description="Shown in the list and the chat's environment menu." value={name} onChange={setName} />
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

const EMPTY_TEMPLATE: TemplateForm = { name: '', provider: DEFAULT_PROVIDER, image: '', system: '', python: '', npm: '', setup: '', env: '', network: true }

function NewTemplateDialog({
  isOpen, onClose, providers, onCreated,
}: { isOpen: boolean; onClose(): void; providers: SandboxProvider[]; onCreated(): void }) {
  const [form, setForm] = useState<TemplateForm>(EMPTY_TEMPLATE)
  const [starters, setStarters] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof TemplateForm>(key: K) => (value: TemplateForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const target = providers.find((p) => (form.provider ? p.name === form.provider : p.default))
  const fields = target?.capabilities.templateFields ?? []
  // Why a field is off: the chosen provider does not apply it.
  const off = (field: string) => (target !== undefined && !fields.includes(field) ? `${target.name} does not apply this; choose a provider that does.` : undefined)

  function pick(value: File | File[] | null) {
    const files = value === null ? [] : Array.isArray(value) ? value : [value]
    setStarters(files.slice(0, MAX_STARTER_FILES))
  }

  async function create() {
    const built = templateBody(form, fields)
    if ('error' in built) return setError(built.error)
    const tooBig = starters.find((f) => f.size > MAX_STARTER_FILE)
    if (tooBig) return setError(`${tooBig.name} is larger than ${formatBytes(MAX_STARTER_FILE)}.`)
    setBusy(true)
    setError(null)
    try {
      await api.createSandboxTemplate({
        ...built.body,
        ...(starters.length > 0 && !off('files')
          ? { files: await Promise.all(starters.map(async (f) => ({ type: 'inline' as const, path: `/workspace/${f.name}`, data: await toBase64(f) }))) }
          : {}),
      })
      onCreated()
      onClose()
      setForm(EMPTY_TEMPLATE)
      setStarters([])
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not save the template.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={600}>
      <DialogHeader title="New template" subtitle="A reusable setup: image, packages, commands and starter files." onOpenChange={(open: boolean) => !open && onClose()} />
      <VStack gap={3} padding={4}>
        {error !== null && <Banner status="error" title={error} />}
        <HStack gap={3} vAlign="start">
          <StackItem size="fill"><TextInput label="Name" value={form.name} onChange={set('name')} /></StackItem>
          {providers.length > 1 && <StackItem size="fill"><Selector label="Provider" options={providerOptions(providers)} value={form.provider} onChange={set('provider')} /></StackItem>}
        </HStack>
        <TextInput label="Image" isOptional placeholder="agentry/sandbox:1" description="The container image. Empty uses the service's default image." value={form.image} onChange={set('image')} isDisabled={off('image') !== undefined} disabledMessage={off('image')} />
        <HStack gap={3} vAlign="start">
          <StackItem size="fill"><TextInput label="System packages" isOptional placeholder="jq, ffmpeg" value={form.system} onChange={set('system')} isDisabled={off('packages') !== undefined} disabledMessage={off('packages')} /></StackItem>
          <StackItem size="fill"><TextInput label="Python packages" isOptional placeholder="pandas, rich" value={form.python} onChange={set('python')} isDisabled={off('packages') !== undefined} disabledMessage={off('packages')} /></StackItem>
          <StackItem size="fill"><TextInput label="npm packages" isOptional placeholder="typescript" value={form.npm} onChange={set('npm')} isDisabled={off('packages') !== undefined} disabledMessage={off('packages')} /></StackItem>
        </HStack>
        <TextArea label="Setup commands" isOptional rows={3} placeholder="One command per line, run in order in the workspace" value={form.setup} onChange={set('setup')} isDisabled={off('setup_commands') !== undefined} disabledMessage={off('setup_commands')} />
        <TextArea label="Environment variables" isOptional rows={3} placeholder={'NAME=value, one per line'} value={form.env} onChange={set('env')} isDisabled={off('env') !== undefined} disabledMessage={off('env')} />
        <Switch label="Internet access" description="Off blocks all outbound traffic. Private networks are always blocked." value={form.network} onChange={set('network')} isDisabled={off('network') !== undefined} disabledMessage={off('network')} />
        <FileInput
          label="Starter files"
          isOptional
          isMultiple
          description={`Copied into the workspace. Up to ${MAX_STARTER_FILES} files of ${formatBytes(MAX_STARTER_FILE)} each.`}
          value={starters}
          onChange={pick}
          isDisabled={off('files') !== undefined}
          disabledMessage={off('files')}
        />
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
              <ToggleButton label="Providers" size="sm" isPressed={view === 'providers'} onPressedChange={() => setView('providers')} />
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
                const look = environmentLook(env)
                const from = templateName(env.template_id)
                const used = lastUsed(env.sandbox?.last_used_at)
                return (
                  <EntityCard
                    key={env.id}
                    href={`/sandboxes/${env.id}`}
                    title={environmentName(env)}
                    leading={<IconTile icon={ServerStackIcon} hue={look.variant === 'success' ? 'green' : look.variant === 'error' ? 'red' : 'slate'} />}
                    trailing={<HStack gap={2} vAlign="center"><StatusDot variant={look.variant} label={look.text} /><Text type="supporting" color="secondary">{look.text}</Text></HStack>}
                    footer={
                      <>
                        <Meta icon={CommandLineIcon}>{env.provider}</Meta>
                        <Meta icon={DocumentDuplicateIcon}>{from ?? 'No template'}</Meta>
                        {env.sandbox?.image && <Meta icon={CubeIcon}>{env.sandbox.image}</Meta>}
                        {used ? <Meta icon={ClockIcon}>{used}</Meta> : <Meta icon={FolderOpenIcon}>{`Created ${shortDate(env.created_at)}`}</Meta>}
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
                trailing={
                  <HStack gap={2} vAlign="center">
                    {p.default && <Text type="supporting" color="secondary">Default</Text>}
                    <StatusDot variant={p.available === false ? 'error' : 'success'} label={p.available === false ? 'Unavailable' : 'Available'} />
                    <Text type="supporting" color="secondary">{p.available === false ? 'Unavailable' : 'Available'}</Text>
                  </HStack>
                }
                footer={[
                  ...providerAbilities(p).map((ability) => <Meta key={ability} icon={CommandLineIcon}>{ability}</Meta>),
                  ...(p.version ? [<Meta key="version" icon={CubeIcon}>{`Version ${p.version}`}</Meta>] : []),
                ]}
              >
                {p.available === false && <Banner status="error" title={p.reason ?? 'Not available right now.'} />}
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
