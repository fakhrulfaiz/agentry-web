'use client'

/**
 * The New template editor: a two-pane dialog like the agent editor. Left: the
 * name, where it runs and a live summary of what the template sets up. Right:
 * the settings, grouped by purpose in tabs. Only the settings the chosen
 * provider applies are shown, and the request never carries the others.
 */
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { FileInput } from '@astryxdesign/core/FileInput'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { CheckCircleIcon, ExclamationCircleIcon, MinusCircleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { SandboxProvider } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { BROWSER_SANDBOX_IMAGE, fieldWords, formatBytes, providerTitle, splitList, templateBody, toBase64, type TemplateForm } from './format'
import { defaultPlace, richestProvider, RunsOnPicker } from './RunsOnPicker'

const MAX_STARTER_FILE = 1024 * 1024
const MAX_STARTER_FILES = 20

type Section = 'software' | 'startup' | 'variables' | 'limits'
const SECTIONS: { value: Section; label: string; fields: string[]; intro: string }[] = [
  { value: 'software', label: 'Software', fields: ['image', 'packages'], intro: 'What is installed before the agent starts. Leave it empty to use the standard image as it is.' },
  { value: 'startup', label: 'Startup', fields: ['files', 'setup_commands'], intro: 'Files the workspace starts with, and commands that run once when the environment is first set up.' },
  { value: 'variables', label: 'Variables', fields: ['env'], intro: 'Environment variables every command sees. Do not put secrets you would not show the agent here.' },
  { value: 'limits', label: 'Internet and limits', fields: ['network', 'resources'], intro: 'Private networks are always blocked. Empty limits use the service defaults.' },
]

const EMPTY: TemplateForm = { name: '', provider: '', image: '', system: '', python: '', npm: '', setup: '', env: '', network: true, cpus: '', memoryGb: '', place: '', gpus: '' }

const WIDE = '@media (min-width: 900px)'
const ui = stylex.create({
  shell: { display: 'flex', flexDirection: 'column', blockSize: 'min(760px, 94dvh)' },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    paddingBlock: 18,
    paddingInlineStart: 24,
    paddingInlineEnd: 16,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'var(--color-border)',
  },
  titles: { flexGrow: 1, minInlineSize: 0 },
  body: {
    flexGrow: 1,
    minBlockSize: 0,
    overflowY: { default: 'auto', [WIDE]: 'hidden' },
    display: { default: 'block', [WIDE]: 'grid' },
    gridTemplateColumns: { default: 'none', [WIDE]: 'minmax(0, 4fr) minmax(0, 6fr)' },
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    padding: 24,
    overflowY: { default: 'visible', [WIDE]: 'auto' },
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
    borderWidth: 0,
    borderInlineEndWidth: { default: 0, [WIDE]: 1 },
    borderBlockEndWidth: { default: 1, [WIDE]: 0 },
  },
  settings: { display: 'flex', flexDirection: 'column', minBlockSize: 0, backgroundColor: 'var(--color-background-muted)' },
  tabs: { paddingInline: 24, paddingBlockStart: 8, flexShrink: 0 },
  panel: { padding: 24, flexGrow: 1, minBlockSize: 0, overflowY: { default: 'visible', [WIDE]: 'auto' } },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 14,
    paddingInline: 24,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-border)',
  },
  grow: { flexGrow: 1, minInlineSize: 0 },
})

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

/** Small counts shown beside each tab. */
function tabNote(section: Section, f: TemplateForm, files: number): string {
  const n = (k: number) => (k > 0 ? String(k) : '')
  if (section === 'software') return n((f.image.trim() ? 1 : 0) + splitList(f.system).length + splitList(f.python).length + splitList(f.npm).length)
  if (section === 'startup') return n(files + lines(f.setup).length)
  if (section === 'variables') return n(lines(f.env).length)
  return f.network ? '' : 'Offline'
}

/** What the template will set up, one line each, for the summary on the left. */
function summary(f: TemplateForm, files: number, fields: string[], image?: string): { text: string; set: boolean }[] {
  const has = (x: string) => fields.includes(x)
  const packages = splitList(f.system).length + splitList(f.python).length + splitList(f.npm).length
  const commands = lines(f.setup).length
  const vars = lines(f.env).length
  const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  const out: { text: string; set: boolean }[] = []
  if (has('image')) out.push(f.image.trim() ? { text: `Image ${f.image.trim()}`, set: true } : { text: `Standard image${image ? ` (${image})` : ''}`, set: false })
  if (has('packages')) out.push({ text: packages ? `${plural(packages, 'package')} to install` : 'No extra packages', set: packages > 0 })
  if (has('files')) out.push({ text: files ? plural(files, 'starter file') : 'Empty workspace', set: files > 0 })
  if (has('setup_commands')) out.push({ text: commands ? plural(commands, 'setup command') : 'No setup commands', set: commands > 0 })
  if (has('env')) out.push({ text: vars ? plural(vars, 'variable') : 'No variables', set: vars > 0 })
  if (has('network')) out.push({ text: f.network ? 'Internet on' : 'Internet off', set: !f.network })
  if (has('resources')) {
    const limits = [f.cpus.trim() && `${f.cpus.trim()} CPU`, f.memoryGb.trim() && `${f.memoryGb.trim()} GB memory`].filter(Boolean).join(', ')
    out.push({ text: limits || 'Default CPU and memory', set: Boolean(limits) })
  }
  return out
}

export function TemplateEditorDialog({ isOpen, onClose, providers, onCreated }: { isOpen: boolean; onClose(): void; providers: SandboxProvider[]; onCreated(): void }) {
  const [form, setForm] = useState<TemplateForm>(EMPTY)
  const [starters, setStarters] = useState<File[]>([])
  const [section, setSection] = useState<Section>('software')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof TemplateForm>(key: K) => (value: TemplateForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  // Each opening starts clean, on the provider that applies the most settings.
  useEffect(() => {
    if (!isOpen) return
    const provider = richestProvider(providers)
    setForm({ ...EMPTY, provider, place: defaultPlace(providers.find((p) => p.name === provider)) })
    setStarters([])
    setSection('software')
    setError(null)
  }, [isOpen, providers])

  const target = providers.find((p) => p.name === form.provider)
  const fields = target?.capabilities.templateFields ?? []
  const has = (f: string) => fields.includes(f)
  const sections = SECTIONS.filter((s) => s.fields.some(has))
  const current = sections.find((s) => s.value === section) ?? sections[0]
  const unsupported = SECTIONS.flatMap((s) => s.fields).filter((f) => !has(f))
  const defaultImage = target?.default_image
  const imageChoice = form.image === '' ? 'standard' : form.image === BROWSER_SANDBOX_IMAGE ? 'browser' : 'custom'
  const chosenPlace = target?.places?.find((pl) => pl.id === form.place)
  const gpuCount = chosenPlace?.gpus?.count ?? 0

  function pick(value: File | File[] | null) {
    const files = value === null ? [] : Array.isArray(value) ? value : [value]
    setStarters(files.slice(0, MAX_STARTER_FILES))
  }

  async function save() {
    const built = templateBody(form, fields)
    if ('error' in built) return setError(built.error)
    const tooBig = starters.find((f) => f.size > MAX_STARTER_FILE)
    if (tooBig) return setError(`${tooBig.name} is larger than ${formatBytes(MAX_STARTER_FILE)}.`)
    setBusy(true)
    setError(null)
    try {
      await api.createSandboxTemplate({
        ...built.body,
        ...(starters.length > 0 && has('files')
          ? { files: await Promise.all(starters.map(async (f) => ({ type: 'inline' as const, path: `/workspace/${f.name}`, data: await toBase64(f) }))) }
          : {}),
      })
      onCreated()
      onClose()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not save the template.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} width="min(1040px, 96vw)" maxHeight="94dvh" padding={0} purpose="form" aria-label="New template">
      <div {...stylex.props(ui.shell)}>
        <header {...stylex.props(ui.header)}>
          <div {...stylex.props(ui.titles)}>
            <Heading level={2} maxLines={1}>{form.name.trim() || 'New template'}</Heading>
            <Text type="supporting" color="secondary" maxLines={1}>A setup new environments start from. Editing it later leaves existing environments as they are.</Text>
          </div>
          <IconButton label="Close" icon={<Icon icon={XMarkIcon} />} variant="ghost" size="sm" onClick={onClose} />
        </header>

        <div {...stylex.props(ui.body)}>
          <section aria-label="Template" {...stylex.props(ui.side)}>
            <TextInput label="Name" value={form.name} onChange={set('name')} placeholder="Python data work" isRequired />
            <RunsOnPicker
              providers={providers}
              value={form.provider}
              place={form.place}
              onChange={(provider) => { setForm((f) => ({ ...f, provider, place: defaultPlace(providers.find((p) => p.name === provider)), gpus: '' })); setSection('software') }}
              onPlaceChange={(provider, place) => { setForm((f) => ({ ...f, provider, place, gpus: '' })); setSection('software') }}
            />
            <VStack gap={2}>
              <Text weight="medium">What it sets up</Text>
              <VStack gap={1.5} role="list" aria-label="What it sets up">
                {summary(form, starters.length, fields, defaultImage?.name).map((line) => (
                  <HStack key={line.text} gap={2} vAlign="center" role="listitem">
                    <Icon icon={line.set ? CheckCircleIcon : MinusCircleIcon} size="sm" color={line.set ? 'success' : 'secondary'} />
                    <Text type="supporting" color={line.set ? 'primary' : 'secondary'}>{line.text}</Text>
                  </HStack>
                ))}
              </VStack>
            </VStack>
          </section>

          <section aria-label="Settings" {...stylex.props(ui.settings)}>
            <div {...stylex.props(ui.tabs)}>
              <TabList value={current?.value ?? 'software'} onChange={(v) => setSection(v as Section)} role="tablist" hasDivider aria-label="Settings">
                {sections.map((s) => (
                  <Tab key={s.value} value={s.value} label={s.label} panelId="template-settings-panel" endContent={<Text type="supporting" color="secondary">{tabNote(s.value, form, starters.length)}</Text>} />
                ))}
              </TabList>
            </div>
            <div {...stylex.props(ui.panel)} role="tabpanel" id="template-settings-panel" aria-label={current?.label}>
              <VStack gap={5}>
                <Text type="supporting" color="secondary">{current?.intro}</Text>

                {current?.value === 'software' && (
                  <>
                    {has('image') && (
                      <Selector
                        label="Image preset"
                        description="Web and browser adds Chromium and Playwright MCP for agents with the browser turned on."
                        options={[
                          { value: 'standard', label: 'Standard', description: 'No browser; the smaller default image' },
                          { value: 'browser', label: 'Web and browser', description: 'Chromium and Playwright MCP' },
                          { value: 'custom', label: 'Custom image', description: 'Type a reference below' },
                        ]}
                        value={imageChoice}
                        onChange={(value) => set('image')(value === 'browser' ? BROWSER_SANDBOX_IMAGE : '')}
                      />
                    )}
                    {has('image') && (
                      <TextInput
                        label="Image"
                        isOptional
                        placeholder={defaultImage?.name ?? 'debian:bookworm'}
                        description={defaultImage?.runtimes
                          ? `Empty uses the standard image: ${Object.entries(defaultImage.runtimes).map(([k, v]) => `${k} ${v}`).join(', ')}${defaultImage.python_packages?.length ? `, with ${defaultImage.python_packages.slice(0, 4).join(', ')} and more` : ''}.`
                          : 'Any Linux image with a shell. Empty uses the standard image.'}
                        value={form.image}
                        onChange={set('image')}
                      />
                    )}
                    {has('packages') && (
                      <>
                        <TextInput label="System packages" isOptional description="Installed with apt or apk, comma separated." placeholder="ffmpeg, poppler-utils" value={form.system} onChange={set('system')} />
                        <TextInput label="Python packages" isOptional description="Installed with pip for the agent user." placeholder="polars, matplotlib" value={form.python} onChange={set('python')} />
                        <TextInput label="npm packages" isOptional description="Installed globally." placeholder="typescript, tsx" value={form.npm} onChange={set('npm')} />
                      </>
                    )}
                  </>
                )}

                {current?.value === 'startup' && (
                  <>
                    {has('files') && (
                      <FileInput
                        label="Starter files"
                        isOptional
                        isMultiple
                        description={`Copied into the workspace. Up to ${MAX_STARTER_FILES} files of ${formatBytes(MAX_STARTER_FILE)} each.`}
                        value={starters}
                        onChange={pick}
                      />
                    )}
                    {has('setup_commands') && (
                      <TextArea label="Setup commands" isOptional description="One per line, run in order in the workspace as the agent user. Setup stops at the first command that fails." rows={6} placeholder={'git clone https://github.com/you/project .\npnpm install'} value={form.setup} onChange={set('setup')} />
                    )}
                  </>
                )}

                {current?.value === 'variables' && has('env') && (
                  <TextArea label="Environment variables" isOptional description="One NAME=value per line. Lines starting with # are ignored." rows={8} placeholder={'TZ=Asia/Kuala_Lumpur\nPIP_INDEX_URL=https://pypi.org/simple'} value={form.env} onChange={set('env')} />
                )}

                {current?.value === 'limits' && (
                  <>
                    {has('network') && (
                      <Switch label="Internet access" description="Off blocks every outbound connection, including package installs after setup." value={form.network} onChange={set('network')} />
                    )}
                    {has('resources') && (
                      <HStack gap={3} vAlign="start">
                        <StackItem size="fill">
                          <TextInput label="CPU cores" isOptional placeholder="Default" description="From 0.1 to 64." value={form.cpus} onChange={set('cpus')} />
                        </StackItem>
                        <StackItem size="fill">
                          <TextInput label="Memory in GB" isOptional placeholder="Default" description="From 0.125 to 256." value={form.memoryGb} onChange={set('memoryGb')} />
                        </StackItem>
                      </HStack>
                    )}
                  </>
                )}

                {current?.value === 'limits' && has('gpus') && gpuCount > 0 && (
                  <Selector
                    label="GPUs"
                    isOptional
                    description={`${chosenPlace?.name ?? 'This place'} has ${gpuCount}. They are reserved for the environment while it runs.`}
                    options={[...Array.from({ length: gpuCount + 1 }, (_, n) => ({ value: String(n), label: String(n) })), { value: 'all', label: 'All' }]}
                    value={form.gpus || '0'}
                    onChange={set('gpus')}
                  />
                )}

                {unsupported.length > 0 && target && (
                  <Text type="supporting" color="secondary">
                    {`${providerTitle(target.name)} does not apply ${fieldWords(unsupported)}. Run it on another provider to set those.`}
                  </Text>
                )}
              </VStack>
            </div>
          </section>
        </div>

        <div {...stylex.props(ui.footer)}>
          <div {...stylex.props(ui.grow)}>
            {error !== null && (
              <HStack gap={1} vAlign="center" role="alert">
                <Icon icon={ExclamationCircleIcon} size="sm" color="error" />
                <Text>{error}</Text>
              </HStack>
            )}
          </div>
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label="Save template" variant="primary" isLoading={busy} onClick={() => void save()} />
        </div>
      </div>
    </Dialog>
  )
}
