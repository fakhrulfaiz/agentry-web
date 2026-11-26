# Vision-capable model route (design)

Status: 2026-11-26, draft for review. Not implemented. Backlog item 4 (and the image half of item 2) in `AGENTS.md`. Plan: `docs/superpowers/plans/2026-11-26-vision-model-route.md`.

## Goal

1. A deployment can offer at least one model that can see images, and the admin knows how to configure it.
2. Users can see which models see images, and choose one per chat or per saved agent.
3. When the current model cannot see an image (an attached picture, a screenshot from a tool, `read_image`), the user is told in plain words, with a one-click switch to a model that can.
4. Images that tools return (browser screenshots) show in the tool card.

## How DSH decides today (read from `~/code/dsh-pinned`)

- Every model entry has `inputModalities` (`packages/llm/llm/src/types.ts` `LlmModelInfo`; `ctx.llm.listModels(provider)` and `ctx.llm.resolveModelInfo(provider, model)`). Absent means unknown; a list without `image` means no.
- Where it is declared:
  - DeepSeek route (`dsh-llm-deepseek`, mounted by `dsh-base`, key `DEEPSEEK_API_KEY`): with no `models` list it advertises `deepseek-flash` (text and image) and `deepseek-v4-pro` (text only). A configured `models` list sets `inputModalities` per entry (`llm-deepseek/src/config.ts`).
  - pi-ai routes (`dsh-llm-pi-ai`, for OpenAI, Anthropic, gateways): installed catalog models carry their own modalities; hand-declared models set `input: [text, image]` per entry, or the route sets `defaultInput: [text, image]` (`docs/config-catalog.md`).
- Who checks:
  - Tool images (MCP results, `read_image`): kept only when the exact routed model **declares** image input; otherwise the model gets `[image unavailable: image/png; model "x" does not declare image input; ...]` (`packages/mcp/mcp-client/src/tools.ts`). `read_image` refuses on such a route.
  - Uploaded pictures (the API's own code, `dsh-agents-api/src/files/ingest.ts` via `AgentsGateway.routeAcceptsImages` in `src/gateway.ts`): sent as images when the route lists `image` **or the modalities are unknown**; otherwise sent as plain files (the model gets the file name and a workspace copy, not the picture).
- The web app offers models from `AGENTRY_WEB_MODELS` plus saved agents' models (`app/api/models/route.ts`); it knows nothing about modalities. There is no models route in the API.

## Design

### 1. Configuring a vision route (docs and config, no code)

- DeepSeek deployments already have one: `deepseek-flash`. Add it to `AGENTRY_WEB_MODELS` (for example `deepseek-v4-pro,deepseek-flash`).
- Other providers: a pi-ai route row in `cordis.patch.yml` (example in the new `dsh-agents-api/docs/models.md`: an OpenAI-compatible gateway with one model declared `input: [text, image]`, key from an env variable through `apiKeyEnv`).
- `docs/models.md` also explains: how to check a model's modalities (`GET /v1/agents/models`, below), what happens on a text-only model, and the image limits (`requestImagePixelBudget`, `maxRequestImageBytes`).

### 2. `GET /agents/models` (API, Agentry extension)

- Returns `{ object: 'list', data: [{ id, provider, name, input_modalities: ['text', 'image'] | null, default: boolean }] }` from `ctx.llm.listProviders()` and `listModels(provider)`, de-duplicated by `id` (first provider wins, the same rule `providerForModel` in `src/gateway.ts` uses to route a model id). `input_modalities: null` means unknown. `default` marks the `agentDefaultModel` selection.
- Cached for 60 s (models change only when the profile reloads; `llm` emits a change event that clears the cache).
- Authenticated like other `/agents/*` routes; no owner filter (models are deployment-wide).

### 3. One rule for "can see images"

The API's upload path treats unknown as yes, DSH's tool path treats unknown as no. The same chat can then see an uploaded picture and not a screenshot. Change `routeAcceptsImages` to require a declared `image` (unknown means no), matching DSH. A deployment whose gateway really accepts images declares it (`defaultInput`), which is one line. The web app uses the same rule: only `input_modalities` containing `image` is shown as "Sees images".

### 4. Choosing a vision model

- Per chat: the composer's model menu (new chats and, since F1.1, mid-chat) marks models that see images with an eye icon and the supporting text "Sees images". No new control.
- Per saved agent: the agent form's model select shows the same mark.
- `app/api/models/route.ts` returns `{ models: string[], images: Record<string, boolean> }`: the same `models` list as today, plus `images[id] = true` for ids the API reports with `image`. Ids the API does not list (a saved agent's stale model) get `false`. When the API models call fails the route still answers with `images: {}` (the list stays usable).

### 5. Telling the user

- **Attaching a picture on a text-only model** (composer, `src/ui/chat/Composer.tsx` and `ComposerAttachments.tsx`): a `Notice` above the input, "deepseek-v4-pro can't see images. It will get the picture as a file only." with a button "Switch to deepseek-flash" (the first model that sees images) that changes the chat's model the same way the model menu does. Sending is still allowed. No notice when no model sees images; instead "No model on this server can see images." once per chat.
- **A tool image the model could not see**: the tool card detects the DSH diagnostic (`[image unavailable: ...; model "..." does not declare image input`) in the output and shows "The model could not see this screenshot (deepseek-v4-pro can't see images)." with the same switch action. Pure detection in `src/chat/image-diagnostic.ts`.
- **Agent guidance (API):** while the session's model cannot see images and the session has tools that return images (browser, `read_image`), a short system prompt section says so: "Your model cannot see images. Work from text (page snapshots, extracted text); if the user needs something only a picture shows, tell them to switch to a model that sees images." This stops the model from retrying screenshots it cannot read. Section `agents-api:vision-guidance`, recomputed per request, so a mid-chat model change takes effect on the next turn.

### 6. Tool images in tool cards (backlog item 2)

- `function_call_output` items gain `images: [{ attachment_id, media_type, width?, height? }]` (Agentry extension) for image blocks in the tool result that DSH admitted (`src/items.ts`, where the output text is built today). Not-admitted images are already text diagnostics and are not listed.
- New route `GET /agents/sessions/{session_id}/attachments/{attachment_id}`: streams the image through `ctx.attachments.readImage` (`dsh-attachment-local`) when the attachment id appears in that session's projected items (the projector keeps a per-session set of attachment ids). Owner scoped like other session routes; 404 otherwise. `Cache-Control: private, max-age=3600`, `X-Content-Type-Options: nosniff`, only `image/*` types.
- BFF: allow-list entry for `GET /agents/sessions/{id}/attachments/{attachment_id}` (attachment ids are DSH ids; the pattern is checked like other id segments). The tool card renders a thumbnail that opens in the existing preview panel.

## Failure modes

- No vision model configured: models list has no "Sees images" marks, composer shows the one-time "No model on this server can see images." notice when a picture is attached; nothing breaks.
- `GET /agents/models` fails: the web keeps its plain list (no marks, no notices that depend on it).
- A model id the catalog does not list (typed into `AGENTRY_WEB_MODELS` or kept by a saved agent): treated as text-only, which is what DSH does for tool images.

## Testing

- API: `GET /agents/models` shape and de-duplication with a fake `llm`; `routeAcceptsImages` unknown-is-no; the guidance section on/off by route and tools; the `images` field on `function_call_output` from a recorded tool result with an image block; the attachment route (owner check, unknown id 404, id from another session 404); OpenAPI drift test.
- Web: `/api/models` merge (`images` map, API failure); `imageDiagnostic` detection; composer notice and switch (component); tool card thumbnail (component). No new e2e.

## Out of scope

Automatic model switching; sending images to a separate "vision helper" subagent (DSH's `subagent` tool has `modelSelection: true`, but without a recorded Host routing policy a child may only use the parent's route, so this needs a spike first); image generation; video.

## Open questions for the user

1. **Unknown modalities:** agree to treat unknown as "cannot see images" everywhere (recommended; a gateway that can declares `defaultInput`)? Today uploads treat unknown as yes.
2. **Vision helper subagent:** worth a spike, so a text-only chat can hand one picture to `deepseek-flash` without switching the whole chat?
3. **Which models to offer:** is `deepseek-flash` the vision model for now, or is another provider (OpenAI, Anthropic, a gateway) planned? That decides what `docs/models.md` shows first.
