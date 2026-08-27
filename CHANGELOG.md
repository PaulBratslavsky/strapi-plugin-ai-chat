# Changelog

Entries from 1.2.0 onward describe what changed and why. Earlier entries are
generated file listings kept for the record.

## 2.8.0 - 2026-08-27

Renamed on npm to `strapi-plugin-ai-chat`. The plugin id is unchanged, so
nothing in an existing install moves.

`ai-sdk` named the dependency rather than what the plugin does. Someone
searching for AI chat or MCP in Strapi would not find it, and the name implied
a wrapper around Vercel's SDK rather than an admin chat surface with a tool
registry other plugins extend.

The id stays `ai-sdk` deliberately. It names five database tables
(`ai_sdk_conversations`, `ai_sdk_memories`, `ai_sdk_notes`,
`ai_sdk_public_memories`, `ai_sdk_tasks`), the `/ai-sdk/*` admin routes, every
`plugin::ai-sdk.tool.*` permission, and the sibling transcripts plugin's own id
and tool prefix. Changing it would be a data migration plus a re-grant across
two plugins, which is not worth a better name. `strapi.name` in package.json
pins it independently of what npm calls the package.

**Upgrading:** change the dependency name, keep everything else. The config key
in `config/plugins.ts` is still `'ai-sdk'`.

```diff
-"strapi-plugin-ai-sdk": "^2.7.0"
+"strapi-plugin-ai-chat": "^2.8.0"
```

## 2.7.0 - 2026-08-26

Stops a hung tool from taking the whole turn with it, and repairs a guard that
had silently stopped working.

- **Tool calls time out.** A tool with no timeout of its own could hang a turn
  indefinitely: the panel showed a spinner on a call that would never settle,
  the step never completed, and nothing was logged, so the failure produced no
  error to read. Calls now abandon after `toolTimeoutMs`, default 60 seconds,
  and reject with a message naming the tool and telling the model to report the
  stall rather than assume success. The tool receives the abort signal, so one
  that honours it stops too, and the request's own signal is passed through, so
  stopping a turn stops a tool already running rather than only the steps after
  it.
- **A Stop control** replaces Send while a turn is running, so a run can be
  abandoned from the panel.
- **History trimming was broken and inert.** It guarded against starting a
  window on an unmatched tool call by checking for a part typed
  `tool-invocation`, which is the AI SDK v4 name and matches nothing this
  plugin stores or streams. The guard never fired. Parts are now recognised by
  the shapes the SDK actually emits, `tool-<toolName>` and `dynamic-tool`, and
  a part carrying its own result is treated as safe to lead with, since a
  UIMessage keeps a call and its result together unlike the model message it
  converts into.
- **Guardrails no longer carry route handling for `/ask` and `/ask-stream`.**
  Those moved to strapi-plugin-ai-sdk-public-chat in 2.0.0, which ships its own
  guardrails. `validateBody`, `createSSEStream` and `writeSSE` go with them,
  having served the content-API routes removed in the same release.

Documentation rewritten throughout.

## 2.6.0 - 2026-08-24

Shows the model's reasoning while it thinks.

Thinking models emit reasoning parts alongside their tool calls and text, and
the panel was storing them and then discarding them at render. A conversation
with `qwen3-14b-32k` persisted `step-start, reasoning, tool-call, reasoning,
text` and displayed only the last of those, so the pause before an answer had
no explanation.

- Reasoning streams into a collapsible panel with a live "Thinking" indicator,
  then settles to "Thought for a moment" with a preview
- The panel opens itself while streaming and follows the text as it arrives
- Typing dots now appear only when there is no reasoning to show, rather than
  alongside it

The empty-reply note is unchanged and still fires on a turn that used tools
without answering, since reasoning is not a reply.

## 2.5.0 - 2026-08-21

Shows how much of the model's context window a conversation is using, in the
chat toolbar.

This is the diagnostic that would have shortened the investigation behind
2.4.0. The plugin sends its system prompt and every tool's JSON schema before
the user's question, measured at about 6,700 tokens on a real install. Ollama
serves a 4,096 token window unless the model file sets `num_ctx`, so a model
advertising 262,144 tokens of context can be quietly truncated to less than the
preamble needs. Nothing reports an error. The model hangs, or answers while
ignoring its tools, and the obvious conclusion is that tool calling is broken.

- New `GET /context-info` reports the system prompt and tool schema cost, the
  window actually in force, and what the weights support when the two differ.
  Measured for the calling admin, since the tool set is filtered by their role
  and the admin with more tools is the one closer to the edge.
- The window is read from a running Ollama instance first, then the model file,
  then Ollama's default, which is the case worth catching. An explicit
  `contextWindow` config option overrides all of it.
- The chat toolbar shows used against available, turning amber past 60 percent
  and red past 90, with a second badge when the preamble cannot fit at all.
- Token usage is attached to each assistant message, so the figure reflects the
  conversation rather than only the starting cost.

Counts are estimated from text length rather than a real tokenizer, which is
enough to say whether you are near the edge without adding a tokenizer per
provider.

## 2.4.0 - 2026-08-20 (`faa3ff0`)

Tool calling was reported as broken: a local model fetched a transcript,
announced it was saving an article, and saved nothing. Running the same code
against a frontier model produced a created article, so the loop, permission
filter, tool wiring and streaming were never at fault. Both models hit the same
wall and only one had the budget to climb it.

- `listContentTypes` reports each field's type and the constraints it carries
  (`required`, `maxLength`, `minLength`, `enum`, `default`), omitting whatever
  an attribute does not set. Field names alone meant a model could not know
  `description` caps at 80 characters until a write was rejected, so schema
  discovery was trial and error paid for in failed writes.
- Tool failures name the field and the reason. Strapi summarises multi-field
  validation as "3 errors occurred" and keeps the causes in `details.errors`,
  which the AI SDK drops because it serialises an error by its message alone. A
  model handed a count can only guess again.
- Tool-use rules are appended after the tool descriptions rather than
  substituted. `composeSystemPrompt` resolved to
  `override || config.systemPrompt || DEFAULT_PREAMBLE`, so any site setting a
  custom prompt silently lost every piece of tool guidance the plugin ships.
- `listContentTypes` accepts an optional `contentType` uid and returns that type
  plus only the components it uses. The full listing measured 11.9KB against a
  real app, and a request already carries roughly 7,000 tokens of system prompt
  and tool schemas before the task is read.
- A blank `baseURL` is treated as absent. `env()` returns `""` for a variable
  that exists but is empty, and an empty string still counts as set by the time
  it reaches a provider, so the Anthropic SDK joined it with the request path
  and called `/messages`, failing as `Invalid URL`.
- A mutating tool is withdrawn once it has returned a result, so a model cannot
  repeat a write it has already completed. Withdrawal keys on results rather
  than calls, so a failed write stays retryable.

Measured afterwards on a transcript-to-article task, checking the database
rather than the reply: a model wrote a 79 character description against an 80
character cap on the first attempt, and where a write still failed the model
read the error, named the limit it had broken, and corrected it on retry.
`qwen3:14b` with a 32k context window completed the task, which no local model
had managed before.

## 2.3.1 - 2026-08-19 (`beeb457`)

The chat header reports whether the model can actually be reached, with a retry
control when it cannot. An unreachable model failed invisibly: the request
opened with a 200 and the stream then died, leaving the panel with no reply and
no explanation.

## 2.2.3 - 2026-08-19 (`2a68c20`)

An assistant turn that ran tools but produced no text now says so instead of
rendering an empty bubble.

## 2.2.2 - 2026-08-19 (`d67ccaa`)

Documentation only. Tightened the bring-your-own-model section.

## 2.2.1 - 2026-08-19 (`edddfe1`)

Documentation only. Named the models and hosting arrangements the plugin
actually supports, and removed claims that were not tested.

## 2.2.0 - 2026-08-19 (`f8e7955`)

Sampling parameters (`temperature`, `topP`, `topK`, penalties, `seed`,
`providerOptions`) are forwarded when configured and omitted entirely
otherwise, so a model that rejects a parameter never sees it. Anthropic's newer
models reject `temperature`, and the `openai-compatible` provider drops `topK`.

## 2.1.0 - 2026-08-19 (`b06ddad`)

Conversations are stored as the AI SDK's `UIMessage` shape, versioned and
validated, and the admin panel uses the SDK's own `useChat`.

The `messages` field is `"type": "json"` and the controller passed
`unknown[]` straight into it, so the stored format had no contract: the schema
was implicitly whatever the admin panel's `Message` interface happened to be
when a row was written. The old shape also lost information, keeping all text
in one string with tool calls in a list beside it, so a turn that ran text,
then a tool, then more text could not be reconstructed. Rows written by earlier
versions are migrated on read.

Removed roughly 256 lines of hand-rolled SSE parsing that handled three event
types and silently discarded the rest. `error` was among them, which is why a
failed stream surfaced as "No response received" rather than the provider's
actual complaint.

## 2.0.1 - 2026-08-19 (`08282c8`)

Removed `@ai-sdk/react`, `lucide-react` and `react-intl`, all declared but
imported nowhere. The public-memory content type is now displayed as "Shared
Memory", since it holds knowledge shared across admins and, after 2.0.0, cannot
be reached by anonymous visitors. The underlying UID and collection name are
deliberately unchanged, because renaming them would orphan existing rows.

## 2.0.0 - 2026-08-19 (`17f8602`, `71302e7`)

**Breaking.** Public chat moved into its own plugin,
`strapi-plugin-ai-sdk-public-chat`, with its own provider, settings, tools and
memory. This plugin is now admin-only.

All five `/api/ai-sdk/*` content-API routes were removed. Anything calling them
should point at the public-chat plugin instead. The Public role's
`plugin::ai-sdk.controller.*` grants no longer refer to anything.

## 1.2.2 - 2026-08-19 (`dbae5aa`)

Four fixes with one root cause: these actions stopped being MCP-specific when
chat began enforcing them, and the naming never caught up.

- The `subCategory` label reads "AI tools" rather than "MCP tools", since it
  appears in Settings > Roles where these actions gate in-Strapi chat.
- `getToolSources()` filters by the caller's permissions. The chat UI listed
  toggles for sources that `createTools()` would then withhold, so switching one
  on appeared to do nothing.
- Dropped a boot-time query against `admin::api-token-permission`. Admin token
  grants live in `admin_permissions`, linked through
  `admin_permissions_api_token_lnk`. That table belongs to content-API tokens
  and can never hold `.tool.*` actions, so the query always returned 0.

## 1.2.1 - 2026-08-19 (`c53006c`)

Added an end-to-end test for MCP permission scoping against a running Strapi.
It asserts that a token granted two actions sees exactly those two tools, that
a token granted nothing receives an empty list rather than an error, and that
calling an ungranted tool is refused, since hiding a tool from discovery and
blocking its execution are separate guarantees.

## 1.2.0 - 2026-08-19 (`50fb18b`)

**Breaking.** Replaced the hand-rolled MCP server with Strapi's built-in one
(5.47 and later), and introduced per-tool permissions.

Every tool now has its own admin action, `plugin::<owning-plugin>.tool.<slug>`.
Tools contributed by another plugin appear under that plugin's section. The
same action gates two callers: granted on a role it decides what an admin's
chat can use, granted on an admin token it decides what that token exposes over
MCP. An ungranted tool is invisible rather than merely blocked.

The four `plugin::ai-sdk.mcp.*` permissions no longer exist and cannot be
granted. Roles and tokens must be re-granted per tool.

Requires `mcp: { enabled: true }` in `config/server.ts`, not
`config/plugins.ts`. Without it the plugin registers no tool permissions at
all, which leaves admin chat with no tools either.

Also added bring-your-own-model support: any OpenAI-compatible endpoint works
through `provider: 'openai-compatible'` with a `baseURL`, and no API key is
required for local runtimes.

## 0.8.0 to 0.10.0 - 2026-03-10 to 2026-04-01

Released without notes. See the commit history for detail.

### 0.7.7 — 2026-03-06 (`961f96f`)
Build succeeds cleanly. Here's a summary of all changes:
- `CHANGELOG.md` (+6, -0)
- `admin/src/components/ToolCallDisplay.tsx` (+2, -2)
- `package.json` (+1, -1)
- `server/src/tool-logic/create-content.ts` (+60, -0)
- `server/src/tool-logic/index.ts` (+5, -2)
- `server/src/tool-logic/update-content.ts` (+77, -0)
- `server/src/tool-logic/upload-media.ts` (+2, -2)
- `server/src/tool-logic/write-content.ts` (+0, -95)
- `server/src/tools/definitions/create-content.ts` (+15, -0)
- `server/src/tools/definitions/index.ts` (+4, -2)
- `server/src/tools/definitions/update-content.ts` (+15, -0)
- `server/src/tools/definitions/write-content.ts` (+0, -15)

### 0.7.5 — 2026-03-06 (`39e465b`)
update controller
- `server/src/controllers/controller.ts` (+2, -2)

