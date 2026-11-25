'use client'

/**
 * The Sandboxes page: Environments (where agents run, with their state and
 * files), Templates (reusable setups) and Providers (the places an
 * environment can run, and what each one has).
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { EmptyState } from '@astryxdesign/core/EmptyState'
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
import {
  CircleStackIcon,
  ClockIcon,
  CommandLineIcon,
  CubeIcon,
  CubeTransparentIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  ServerIcon,
  Square3Stack3DIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { SandboxEnvironment, SandboxProvider, SandboxRuntimes, SandboxTemplate } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { CardGrid, EntityCard, Fact } from '@/ui/cards/EntityCard'
import { IconTile } from '@/ui/shared/IconTile'
import { environmentLook, environmentName, fieldWords, lastUsed, providerBlurb, providerTitle, shortDate, shortId, templateSummary } from './format'
import { defaultPlace, initialProvider, RunsOnPicker } from './RunsOnPicker'
import { TemplateEditorDialog } from './TemplateEditorDialog'
import { useCachedState } from '@/ui/page-cache'

const COLUMN_WIDTH = 880
type View = 'environments' | 'templates' | 'providers'
/** While any environment is changing state, the list refreshes this often. */
const SETTLING_POLL_MS = 3000

function Meta({ icon, children }: { icon: typeof FolderOpenIcon; children: string }) {
  return <Fact icon={<Icon icon={icon} size="sm" color="secondary" />}>{children}</Fact>
}

const providerIcon = (name: string) => (name === 'local' ? ServerIcon : CubeTransparentIcon)
const settling = (env: SandboxEnvironment) => env.status === 'pending' || env.sandbox?.state === 'provisioning' || env.sandbox?.state === 'deleting'

function NewEnvironmentDialog({
  isOpen, onClose, templates, providers, onCreated,
}: { isOpen: boolean; onClose(): void; templates: SandboxTemplate[]; providers: SandboxProvider[]; onCreated(): void }) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('')
  const [place, setPlace] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setName('')
    const first = initialProvider(providers)
    setProvider(first)
    setPlace(defaultPlace(providers.find((p) => p.name === first)))
    setTemplateId('')
    setError(null)
  }, [isOpen, providers])

  // Only templates made for the chosen place can start here.
  const fitting = templates.filter((t) => t.provider === provider)
  const chosen = fitting.find((t) => t.id === templateId)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await api.createSandboxEnvironment({ ...(templateId ? { templateId } : {}), ...(provider ? { provider } : {}), ...(provider === 'sandbox' && place ? { place } : {}), ...(name.trim() ? { name: name.trim() } : {}) })
      // A refused sandbox (a limit, a failed setup) is recorded as failed: show why here instead of closing.
      if (created.status === 'failed' && created.error) {
        onCreated()
        return setError(created.error)
      }
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
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={520}>
      <DialogHeader title="New environment" subtitle="A workspace an agent runs in, with its own files." onOpenChange={(open: boolean) => !open && onClose()} />
      <VStack gap={4} padding={4}>
        <TextInput label="Name" isOptional placeholder="Data analysis" description="Shown in the list and in the new-chat environment menu." value={name} onChange={setName} />
        {providers.length > 0 && <RunsOnPicker
          providers={providers}
          value={provider}
          place={place}
          onChange={(p) => { setProvider(p); setPlace(defaultPlace(providers.find((x) => x.name === p))); setTemplateId('') }}
          onPlaceChange={(p, pl) => { setProvider(p); setPlace(pl); setTemplateId('') }}
        />}
        <Selector
          label="Template"
          description={fitting.length > 0 ? 'Start from a saved setup, or from nothing.' : `No templates for ${providerTitle(provider).toLowerCase()} yet. It starts from nothing.`}
          options={[{ value: '', label: 'Start from nothing' }, ...fitting.map((t) => ({ value: t.id, label: t.name || 'Untitled template', description: templateSummary(t) }))]}
          value={templateId}
          onChange={setTemplateId}
          isDisabled={fitting.length === 0}
        />
        {chosen && chosen.unsupported_fields.length > 0 && (
          <Banner status="warning" title={`This template sets ${fieldWords(chosen.unsupported_fields)}, which ${providerTitle(chosen.provider).toLowerCase()} cannot apply, so it will not start.`} />
        )}
        {error !== null && <Banner status="error" title={error} />}
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label="Create environment" variant="primary" isLoading={busy} isDisabled={!provider} onClick={() => void create()} />
        </HStack>
      </VStack>
    </Dialog>
  )
}

/** The Providers tab: one card per place to run, with what each one has. */
function ProviderCard({ provider: p, runtimes }: { provider: SandboxProvider; runtimes: SandboxRuntimes | null }) {
  const down = p.available === false
  const image = p.default_image
  const software: string[] = []
  if (p.name === 'local' && runtimes?.available) {
    if (runtimes.node) software.push(`Node ${runtimes.node}`)
    if (runtimes.python) software.push(`Python ${runtimes.python}`)
    if (runtimes.pnpm) software.push(`pnpm ${runtimes.pnpm}`)
  }
  if (image?.runtimes) software.push(...Object.entries(image.runtimes).map(([k, v]) => `${k === 'node' ? 'Node' : k === 'python' ? 'Python' : k} ${v}`))
  const packages = p.name === 'local' ? Object.keys(runtimes?.python_packages ?? {}) : (image?.python_packages ?? [])
  return (
    <EntityCard
      title={providerTitle(p.name)}
      leading={<IconTile icon={providerIcon(p.name)} hue={down ? 'slate' : p.name === 'local' ? 'teal' : 'blue'} />}
      trailing={
        <HStack gap={2} vAlign="center">
          <StatusDot variant={down ? 'error' : 'success'} label={down ? 'Unavailable' : 'Available'} />
          <Text type="supporting" color="secondary">{down ? 'Unavailable' : p.default ? 'Default' : 'Available'}</Text>
        </HStack>
      }
      footer={software.map((s) => <Meta key={s} icon={CommandLineIcon}>{s}</Meta>)}
    >
      <VStack gap={2}>
        {down ? <Banner status="error" title={p.reason ?? 'Not available right now.'} /> : <Text type="supporting" color="secondary">{providerBlurb(p.name)}</Text>}
        {image && <Text type="supporting" color="secondary">{`Standard image ${image.name}${image.tools?.length ? `, with ${image.tools.join(', ')}` : ''}.`}</Text>}
        {packages.length > 0 && (
          <Text type="supporting" color="secondary">
            {`Python includes ${packages.slice(0, 6).join(', ')}${packages.length > 6 ? ` and ${packages.length - 6} more` : ''}.`}
          </Text>
        )}
        <Text type="supporting" color="secondary">
          {p.capabilities.templateFields.length > 0 ? `Templates can set ${fieldWords(p.capabilities.templateFields)}.` : 'Templates cannot change anything here.'}
          {p.version ? ` Docker ${p.version}.` : ''}
        </Text>
        {!p.capabilities.exec && <Text type="supporting" color="secondary">Cannot run an agent&apos;s tools, so chats cannot use it yet.</Text>}
      </VStack>
    </EntityCard>
  )
}

export function SandboxesPage() {
  const [view, setView] = useState<View>('environments')
  const [environments, setEnvironments] = useCachedState<SandboxEnvironment[]>('sandboxes.environments')
  const [templates, setTemplates] = useCachedState<SandboxTemplate[]>('sandboxes.templates')
  const [providers, setProviders] = useCachedState<SandboxProvider[]>('sandboxes.providers')
  const [runtimes, setRuntimes] = useCachedState<SandboxRuntimes>('sandboxes.runtimes')
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
      // The runtimes are informative; an older backend without the endpoint just shows less.
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

  // An environment that is setting up or being deleted settles on its own: refresh until it does.
  const anySettling = environments?.some(settling) ?? false
  useEffect(() => {
    if (!anySettling) return
    const timer = setInterval(() => {
      api.listSandboxEnvironments().then((page) => setEnvironments(page.data), () => undefined)
    }, SETTLING_POLL_MS)
    return () => clearInterval(timer)
  }, [anySettling])

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
        <VStack gap={1}>
          <Heading level={1} type="display-2">Sandboxes</Heading>
          <Text color="secondary">Where your agents run their commands and keep their files.</Text>
        </VStack>
        <HStack gap={3} vAlign="center" wrap="wrap">
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
                    leading={<IconTile icon={providerIcon(env.provider)} hue={look.variant === 'success' ? (env.provider === 'local' ? 'teal' : 'blue') : look.variant === 'error' ? 'red' : 'slate'} />}
                    trailing={<HStack gap={2} vAlign="center"><StatusDot variant={look.variant} label={look.text} /><Text type="supporting" color="secondary">{look.text}</Text></HStack>}
                    footer={
                      <>
                        <Meta icon={providerIcon(env.provider)}>{providerTitle(env.provider)}</Meta>
                        {from && <Meta icon={DocumentDuplicateIcon}>{from}</Meta>}
                        {env.sandbox?.image && <Meta icon={CubeIcon}>{env.sandbox.image}</Meta>}
                        {used ? <Meta icon={ClockIcon}>{used}</Meta> : <Meta icon={FolderOpenIcon}>{`Created ${shortDate(env.created_at)}`}</Meta>}
                      </>
                    }
                  >
                    {env.error
                      ? <Text type="supporting" color="secondary" maxLines={2}>{env.error}</Text>
                      : !env.name && <Text type="supporting" color="secondary">{shortId(env.id)}</Text>}
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
              description="A template saves a setup (software, starter files, commands) so every new environment begins the same way."
              actions={<Button label="New template" onClick={() => setDialog('template')} />}
            />
          ) : (
            <CardGrid label="Templates">
              {templates.map((tpl) => (
                <EntityCard
                  key={tpl.id}
                  title={tpl.name || 'Untitled template'}
                  leading={<IconTile icon={Square3Stack3DIcon} hue="violet" />}
                  trailing={tpl.built_in ? <Text type="supporting" color="secondary">Built in</Text> : <IconButton label={`Delete ${tpl.name || 'template'}`} size="sm" variant="ghost" icon={<Icon icon={TrashIcon} />} onClick={() => setRemoving(tpl)} />}
                  footer={
                    <>
                      <Meta icon={providerIcon(tpl.provider)}>{providerTitle(tpl.provider)}</Meta>
                      {tpl.unsupported_fields.length > 0 && (
                        <Fact icon={<Icon icon={ExclamationTriangleIcon} size="sm" color="warning" />}>
                          {`${providerTitle(tpl.provider)} cannot apply ${fieldWords(tpl.unsupported_fields)}`}
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
          <CardGrid label="Providers">
            {providers.map((p) => <ProviderCard key={p.name} provider={p} runtimes={runtimes} />)}
          </CardGrid>
        )}
      </VStack>

      <NewEnvironmentDialog isOpen={dialog === 'environment'} onClose={() => setDialog(null)} templates={templates ?? []} providers={providers ?? []} onCreated={() => void load()} />
      <TemplateEditorDialog isOpen={dialog === 'template'} onClose={() => setDialog(null)} providers={providers ?? []} onCreated={() => void load()} />
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
