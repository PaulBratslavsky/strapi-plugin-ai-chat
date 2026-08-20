# Strapi Plugin AI SDK

An AI chat assistant inside the Strapi v5 admin panel, and an MCP tool server that
exposes the same tools to external AI clients through Strapi's official `/mcp`
endpoint.

Built on the [Vercel AI SDK](https://ai-sdk.dev/). Ships with two providers —
Anthropic Claude and any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio) —
and you can register your own.

The plugin has exactly two surfaces:

| Surface | Where | Who authenticates | What it can use |
|---|---|---|---|
| **Admin chat** | `/ai-sdk/*` in the admin panel | Logged-in admin (session) | The tools that admin's **role** grants |
| **MCP** | Strapi's own `POST /mcp` | Admin API token | The tools that **token** grants |

The plugin does not serve `/mcp` itself — it registers its tools onto Strapi's
built-in MCP server at boot.

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration reference](#configuration-reference)
- [Providers](#providers)
- [Permissions](#permissions)
- [Connecting an MCP client](#connecting-an-mcp-client)
- [Available tools](#available-tools)
- [Memory, shared memory, notes and tasks](#memory-shared-memory-notes-and-tasks)
- [Guardrails](#guardrails)
- [Extending with custom tools](#extending-with-custom-tools)
- [Upgrading from 1.x](#upgrading-from-1x)
- [Testing](#testing)
- [Documentation](#documentation)

---

## Requirements

- **Strapi >= 5.47** — earlier versions have no `strapi.ai.mcp`, and the plugin's
  tool permissions are registered as part of the MCP registration pass. Without
  it, chat has no tools (see [step 3](#3-enable-strapis-mcp-server)).
- React 18, `react-router-dom` 6, `styled-components` 6 — the standard Strapi v5
  admin peer set.
- An API key for whichever model provider you use.
- `@strapi/plugin-email` with a configured provider, if you want the `sendEmail`
  tool to work.

## Installation

### 1. Install the package

```bash
npm install strapi-plugin-ai-sdk
```

### 2. Configure the plugin

```typescript
// config/plugins.ts
export default ({ env }) => ({
  'ai-sdk': {
    enabled: true,
    config: {
      apiKey: env('ANTHROPIC_API_KEY'),
      chatModel: 'claude-sonnet-5',
    },
  },
});
```

That is the whole minimum. Every other option has a working default — see the
[configuration reference](#configuration-reference).

### 3. Enable Strapi's MCP server

This lives in a **different file**, `config/server.ts`, because it is a
host-application switch, not a plugin setting. No plugin can turn it on for you.

```typescript
// config/server.ts
export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  mcp: {
    enabled: true,
  },
});
```

> **Do not skip this even if you never plan to use MCP.** The plugin registers one
> admin permission action per tool inside its MCP registration pass. If MCP is
> disabled, that pass returns early, no tool actions are registered, and nothing
> can be granted — so the **admin chat gets no tools either**. You will see this
> at boot:
>
> ```
> [ai-sdk:mcp] Official MCP server not enabled — skipping tool registration.
> ```

### 4. Set environment variables

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

### 5. Build and start

```bash
npm run build
npm run develop
```

A healthy boot logs something like:

```
[ai-sdk] AI provider configured: provider="anthropic", model="claude-sonnet-5". Resolution happens lazily on first use.
[ai-sdk] Scanning N plugins for ai-tools: [...]
[ai-sdk:mcp] Registered 9 custom admin permission(s).
[ai-sdk:mcp] Registered 8 tool(s) on the official MCP server.
```

### 6. Grant the tools

A fresh install registers one permission action per tool and grants none of them
to anyone — except the Super Admin role, which Strapi re-syncs with every
registered action on each boot. So chat works immediately if you are a Super
Admin, and has **no tools at all** for every other role, and for every admin API
token, until you tick them.

Read [Permissions](#permissions) next. This is the step people miss, and its
symptom (an assistant that politely declines to do anything) looks nothing like a
permissions problem.

Then open **AI SDK** in the admin sidebar and start chatting.

---

## Configuration reference

Everything under `config` in `config/plugins.ts`:

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `''` | API key for the provider. |
| `provider` | `string` | `'anthropic'` | `'anthropic'`, `'openai-compatible'`, or a name you registered yourself. |
| `chatModel` | `string` | `'claude-sonnet-5'` | Any model id the provider accepts. Not an allow-list. |
| `baseURL` | `string` | — | Provider endpoint override. **Required** when `provider` is `'openai-compatible'`. |
| `temperature` | `number` | — | Omitted unless set. Anthropic's newer models reject it. |
| `topP` | `number` | — | Omitted unless set. |
| `topK` | `number` | — | Omitted unless set. Not forwarded by `openai-compatible`. |
| `systemPrompt` | `string` | built-in prompt | Replaces the default preamble. A `{tools}` placeholder is substituted with the tool list; without it, the tool list is appended. |
| `maxOutputTokens` | `number` | `8192` | Cap on model output per response. |
| `maxConversationMessages` | `number` | `15` | History is trimmed to this many messages, keeping tool-call/result pairs intact. |
| `maxSteps` | `number` | `10` | Tool-call round trips before the model must stop. |
| `guardrails` | `object` | see below | Prompt-injection screening. See [Guardrails](#guardrails). |
| `anthropicApiKey` | `string` | `''` | **Deprecated.** Fallback for existing installs; use `apiKey`. Logs a warning at boot. |

`guardrails` accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Set `false` to skip screening entirely. |
| `maxInputLength` | `number` | `10000` | Characters. Over-length input is blocked. |
| `additionalPatterns` | `string[]` | `[]` | Extra regex sources, compiled case-insensitively. |
| `disableDefaultPatterns` | `boolean` | `false` | Drop the built-in pattern set and use only your own. |
| `blockedMessage` | `string` | built-in message | What the user sees when a request is blocked. |
| `beforeProcess` | `function` | — | `async ({ text, route, ctx }) => ({ blocked, reason?, sanitized? })`. Runs before pattern matching. |

Config is validated at boot: `apiKey`, `anthropicApiKey`, `chatModel`, `provider`
and `baseURL` must be strings, and `openai-compatible` without a `baseURL` throws.

---

## Providers

The plugin talks to three kinds of model through the same two providers. Which
you pick changes where your content goes, not how anything else works — the
tools, permissions, and MCP surface are identical.

| | Provider | Where inference happens | Content leaves your network |
|---|---|---|---|
| **Frontier** | `anthropic` | Anthropic's API | yes |
| **Hosted OpenAI-compatible** | `openai-compatible` | a vendor's endpoint | yes |
| **Local / self-hosted** | `openai-compatible` | your machine or LAN | **no** |

### Frontier: Anthropic

```typescript
// config/plugins.ts
export default ({ env }) => ({
  'ai-sdk': {
    enabled: true,
    config: {
      apiKey: env('ANTHROPIC_API_KEY'),
      chatModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5'),
    },
  },
});
```

`provider` defaults to `anthropic`, so it can be omitted.

Do **not** set `temperature` here. Anthropic's newer models reject it outright
with *"`temperature` is deprecated for this model"*, which fails every request.
The plugin omits sampling parameters unless you set them, so leaving them alone
is the working configuration.

### Local: Ollama, vLLM, LM Studio, llama-swap

Anything speaking the OpenAI wire format. `baseURL` is required; `apiKey` is
not, since self-hosted runtimes generally have no auth.

```typescript
// config/plugins.ts — Ollama on the same machine
export default ({ env }) => ({
  'ai-sdk': {
    enabled: true,
    config: {
      provider: 'openai-compatible',
      baseURL: env('AI_BASE_URL', 'http://localhost:11434/v1'),
      chatModel: env('AI_CHAT_MODEL', 'llama3.1:8b'),
    },
  },
});
```

Nothing leaves the machine: the model, your content, and every tool result stay
local. That is the point of this path — the same admin chat and the same tools,
without sending CMS content to a hosted API.

A server on your network works the same way; give it the host and a key if it
requires one:

```typescript
provider: 'openai-compatible',
baseURL: env('AI_BASE_URL', 'http://ai1.example.internal:9001/v1'),
apiKey: env('AI1_API_KEY'),          // some gateways require one
chatModel: env('AI_CHAT_MODEL', 'qwen3.6-35b'),
temperature: 1,
topP: 0.95,
```

The chat header marks inference **LOCAL** when `baseURL` points at a loopback,
`.local`, or private-range host.

### Hosted OpenAI-compatible

Same provider, a vendor's endpoint instead of yours — Together, Groq, Fireworks,
OpenRouter, or an OpenAI-compatible gateway:

```typescript
provider: 'openai-compatible',
baseURL: env('AI_BASE_URL', 'https://api.together.xyz/v1'),
apiKey: env('AI_API_KEY'),
chatModel: env('AI_CHAT_MODEL', 'Qwen/Qwen3-235B-A22B'),
```

### Choosing a model

Tool calling is the requirement, not general fluency. This plugin's entire value
is the model deciding to call `searchContent`, reading the result, and answering
from it. A model that cannot call tools reliably will describe what it *would*
do instead of doing it.

Verified working here: `claude-sonnet-5`, `qwen3.6-35b`, `llama3.1:8b`.

**Reasoning models need output headroom.** Qwen 3.6 spent 193 completion tokens
reasoning before answering a one-word question; with `maxOutputTokens: 30` it
returned nothing at all, because the budget was gone before it produced any
visible text. The default of 8192 is comfortable — but if you lower it, short
answers can come back empty.

Expect them to be slower, too. A two-step tool loop against a local 35B took
about 23 seconds end to end.

### Sampling parameters

All optional, all omitted unless set, because the right values are
model-specific and a wrong one is often a hard failure rather than a nudge.

| Option | Notes |
|---|---|
| `temperature` | Anthropic's newer models **reject** it. Qwen documents `1`. |
| `topP` | Qwen documents `0.95`. |
| `topK` | **Not forwarded by `openai-compatible`** — the OpenAI wire format has no `top_k`, so the SDK warns and drops it. Works with providers that support it. |
| `frequencyPenalty`, `presencePenalty`, `seed` | Passed through when supported. |
| `providerOptions` | Escape hatch for provider-specific fields the config does not name. |

### Registering another provider

Both built-ins are registered the same way any plugin can, in `bootstrap()`:

```typescript
import { AIProvider } from 'strapi-plugin-ai-sdk/server/lib/ai-provider';
import { createMistral } from '@ai-sdk/mistral';

AIProvider.registerProvider('mistral', ({ apiKey, baseURL }) => {
  const provider = createMistral({ apiKey, baseURL });
  return (modelId: string) => provider(modelId);
});
```

Then set `provider: 'mistral'` in config. Registration is resolved lazily on
first use, so ordering relative to this plugin's own bootstrap does not matter.

---

## Permissions

This is the part that decides whether anything works, so it is worth reading in
full.

### One action per tool

Every tool registers a single admin permission action:

```
plugin::<owning-plugin>.tool.<slug>

plugin::ai-sdk.tool.search-content
plugin::ai-sdk.tool.send-email
plugin::ai-sdk-yt-transcripts.tool.fetch-transcript
```

Slugs use **hyphens** (Strapi's uid validator rejects underscores), while the MCP
wire name for the same tool is snake_case — `search_content`. Both are derived
from the same registry entry, so they can never drift.

A tool contributed by another plugin registers its action under **that plugin's**
section of the permissions grid, not under ai-sdk's. ai-sdk discovers the tool;
the contributing plugin owns the permission. Uninstalling that plugin takes its
actions with it.

### The same actions gate two different callers

| Grant it on | In | Controls |
|---|---|---|
| An **admin role** | Settings → Roles | What that admin's chat can use |
| An **admin API token** | Settings → Admin Tokens | What that token exposes over `/mcp` |

Both kinds of grant are rows in `admin_permissions`, which is why one set of
actions covers both. Content-API tokens play no part in this plugin.

### Ungranted means invisible

A caller without a tool's action does not get "permission denied" — the tool is
never offered at all. Over MCP it is absent from `tools/list`; in chat it is never
put in front of the model. A token holding none of these actions gets a
**successful, empty** `tools/list`.

### Granting them

**For chat** — Settings → Administration Panel → **Roles** → pick a role → find
each plugin's section (yours is **AI SDK**, plus one section per tool-contributing
plugin) → tick the tools that role may use → Save. Users must re-log or refresh
for a new ability to take effect.

**For MCP** — Settings → Administration Panel → **Admin Tokens** → create or edit
a token → tick the tools that token may reach → Save.

> **Super Admin is a special case.** Strapi re-assigns every registered permission
> action to the Super Admin role on each boot, so a Super Admin's chat picks up all
> tools without you ticking anything. Every other role — and **every** admin token,
> including one owned by a Super Admin — starts with nothing and must be granted
> explicitly. If you test with a Super Admin account and then hand the plugin to an
> Editor, expect the Editor's chat to have no tools until you grant them.

### Boot warning: nothing grants any tool

If no role and no token grants a single tool action, the plugin warns at boot:

```
[ai-sdk:mcp] N tool permission(s) registered, but no role or API token grants any
of them. MCP clients will authenticate successfully and receive an EMPTY
tools/list, and in-Strapi chat will have no tools. ...
```

The check is advisory and never blocks boot. Note that it runs before Strapi
re-syncs Super Admin permissions, so you will see it once on a brand-new install
even though the Super Admin is granted moments later.

---

## Connecting an MCP client

`/mcp` is Strapi's own endpoint, using streamable HTTP and authenticated with an
**Admin API token** — a Content API token will not work.

1. **Mint the token.** Settings → Administration Panel → **Admin Tokens** → Create
   new Admin Token. Copy the value; it is shown once.
2. **Scope it.** On the same screen, tick only the tools that client should reach.
   A token granted two tools lists exactly two tools.
3. **Point the client at it.** Clients that can send headers connect directly to
   `http://localhost:1337/mcp` with `Authorization: Bearer <token>`. For clients
   that cannot, `mcp-remote` bridges the gap:

```json
{
  "mcpServers": {
    "strapi": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "http://localhost:1337/mcp",
        "--header", "Authorization:Bearer ${STRAPI_ADMIN_TOKEN}"
      ],
      "env": { "STRAPI_ADMIN_TOKEN": "your-admin-token" }
    }
  }
}
```

The plugin also registers one MCP resource, `strapi://ai-sdk/tools/guide`, gated
behind `plugin::ai-sdk.tool.guide`. It is generated on each read from the live
registry, so contributed tools appear in it automatically. Tool results larger
than roughly 1 MB on the wire are replaced with a truncation notice rather than
failing the call.

**A token that authenticates but sees no tools is not broken** — it has no tool
actions granted. See [Permissions](#permissions).

---

## Available tools

Eight tools reach MCP. Six more are chat-only (`internal: true`) and are never
exposed over MCP.

| Tool | MCP name | Risk tier | What it does |
|---|---|---|---|
| `listContentTypes` | `list_content_types` | read | Lists content types and components with fields, relations, and UIDs. The starting point for everything else. |
| `searchContent` | `search_content` | read | Queries any content type with Strapi filters, sorting, and pagination. |
| `findOneContent` | `find_one_content` | read | Fetches one document by `documentId` with relations populated. |
| `aggregateContent` | `aggregate_content` | read | Counts and groups entries — totals, counts by field, counts by date bucket. |
| `createContent` | `create_content` | write | Creates a document in any content type. |
| `updateContent` | `update_content` | write | Updates an existing document. |
| `uploadMedia` | `upload_media` | write | Uploads a file from a URL into the media library and returns its id. |
| `sendEmail` | `send_email` | destructive | Sends an email through Strapi's email plugin. Requires `@strapi/plugin-email` and a configured provider. |

Chat-only tools: `saveMemory`, `recallMemories`, `recallPublicMemories`,
`saveNote`, `recallNotes`, `manageTask`.

Chat-only tools need no permission grant. They are always available to the
assistant, because they operate on the calling admin's own memories, notes and
tasks rather than on project content.

The risk tier is **metadata only** — it labels a tool in the permissions grid to
help you decide what to tick. It grants nothing and gates nothing; the per-tool
action does all the gating.

---

## Memory, shared memory, notes and tasks

The chat header links to three stores, all managed from the admin panel and all
readable by the assistant.

- **Memory Store** — facts about *you*. Every row is scoped to `adminUserId`, so
  another admin never sees your memories, and they are injected into your system
  prompt on each chat request.
- **Shared Memory Store** — team knowledge: product details, policies, conventions.
  Visible to every admin in the project. Backed by the `public-memory` content
  type; the name is historical and does **not** mean visible to anonymous
  visitors — this plugin has no anonymous surface.
- **Research Notes** — snippets, findings, and references saved out of a
  conversation as markdown. Per-admin.

Tasks are per-admin too, scored by consequence × impact. When the assistant creates
one it renders a confirmation card in the chat for you to set the scores.

Conversations are stored per admin user and listed in the chat sidebar.

---

## Guardrails

A route middleware screens input to the admin chat route (`POST /ai-sdk/chat`)
before it reaches the model. It:

1. runs your `beforeProcess` hook, if configured;
2. normalizes the text — NFKC, strip zero-width and invisible characters, collapse
   whitespace — so obfuscated variants still match;
3. tests it against the compiled patterns (5 built-in categories: prompt injection,
   jailbreak, system-prompt extraction, system-prompt mimicry, destructive
   commands) plus anything in `additionalPatterns`;
4. enforces `maxInputLength`.

A blocked chat request is answered as a normal SSE assistant message, so the UI
renders the refusal inline instead of erroring.

> **Scope: this covers the admin chat route only. It does not cover `/mcp`.**
> That endpoint belongs to Strapi, not to this plugin, so there is no route-scoped
> middleware slot on it — MCP tool-call arguments reach the tool unscreened. What
> constrains MCP is access control instead: admin-token authentication plus
> per-tool permissions. If you need content screening there, put it in the tool's
> logic or in a global `strapi.server.use()` middleware. See
> [`docs/guardrails.md`](./docs/guardrails.md).

---

## Extending with custom tools

Any other Strapi plugin can contribute tools. At boot, `discoverPluginTools()`
scans every registered plugin for a service named exactly `ai-tools`.

```typescript
// your-plugin/server/src/services/ai-tools.ts
import { z } from 'zod'; // your own zod, never '@strapi/utils'

export default () => ({
  getTools() {
    return [
      {
        name: 'fetchTranscript',
        description: 'Fetch the transcript of a YouTube video by id.',
        schema: z.object({
          videoId: z.string().describe('The YouTube video id'),
        }),
        async execute(args, strapi, context) {
          return { transcript: '...' };
        },
        access: 'maintenance', // optional risk label
      },
    ];
  },

  // Optional — feeds the tool-guide MCP resource
  getMeta() {
    return {
      label: 'YouTube Transcripts',
      description: 'Fetch, search, and read YouTube video transcripts',
      keywords: ['/youtube', '/yt', 'transcript'],
    };
  },
});
```

`ToolDefinition` fields:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | camelCase. Namespaced to `<plugin-id>__<name>` in the registry. |
| `description` | yes | Sent to the model verbatim. This is your main lever on whether it gets called well. |
| `schema` | yes | A `z.ZodObject`. |
| `execute` | yes | `(args, strapi, context?) => Promise<unknown>`. |
| `internal` | no | `true` keeps the tool out of MCP entirely; chat-only, and exempt from permission checks. |
| `access` | no | `'read' \| 'write' \| 'destructive' \| 'maintenance'`. Risk label shown in the permissions grid. Defaults to `'read'` when `publicSafe` is set, otherwise `'write'`. |
| `publicSafe` | no | Risk metadata only — it grants nothing. It used to decide what anonymous chat could reach; that surface no longer exists here. |

Things worth knowing:

- **Your tool's permission appears under your plugin's own section** of the
  permissions grid, as `plugin::<your-plugin-id>.tool.<slug>` — not under AI SDK's.
  A brand-new tool starts ungranted and is invisible until someone ticks it.
- **Import `z` from your own `zod`**, never from `@strapi/utils`. Both are Zod 4,
  but `.describe()` text lives in a per-instance registry, and the MCP SDK reads it
  through its own instance — a schema built with a different instance registers
  fine and silently loses every parameter description.
- **Failures are isolated.** A tool missing `name`, `execute`, or `schema` is
  skipped with a warning; one tool failing to register does not stop the others;
  and a failure anywhere in the registration pass is logged, not thrown, so Strapi
  still boots.
- **Object and array parameters get no automatic JSON-string coercion.** If your
  clients may send `'["a","b"]'` for an array parameter, wrap it — see
  `jsonCoercible()` in `server/src/lib/json-coercible.ts`.

Full contract, including namespacing and naming rules:
[`docs/plugin-contract.md`](./docs/plugin-contract.md).

## Upgrading from 1.x

**Permission grants are pruned.** Versions before 1.2.0 gated MCP behind four tier
actions — `plugin::ai-sdk.mcp.read`, `.write`, `.destructive`, `.maintenance`.
Those actions no longer exist, so Strapi deletes every permission row that
referenced them.

The symptom is deeply misleading: your admin token still authenticates, `/mcp`
still responds, `tools/list` still returns `200` — with an empty list. Boot logs
look completely healthy. 2.0.1 adds a boot warning for exactly this state.

**The fix:** re-grant the tools individually. For each admin token, Settings →
Admin Tokens → tick the tools it should reach. For each non-Super-Admin role,
Settings → Roles → tick the tools that role's chat should use.

**Also removed in 2.0.0:** the content-API routes (`/api/ai-sdk/ask`,
`/ask-stream`, `/chat`, `/public-chat`) and the embeddable widget. Anonymous chat
now lives in a separate plugin, `strapi-plugin-ai-sdk-public-chat`, not yet
published to npm.

---

## Developing against a local Strapi

Changes to the plugin's **admin** code need two builds, not one:

```bash
# in the plugin
npm run build

# in the host app — this is the step that is easy to miss
npx strapi build
npx strapi start
```

Strapi compiles plugin admin code into the host's own admin bundle. Rebuilding
the plugin and restarting the server updates the backend but leaves the browser
serving the previously built admin, so admin-side changes appear to have no
effect — including changes that would otherwise be obvious, like a component
that no longer exists still rendering.

Server-side changes only need the plugin build and a restart.

If something you just changed is not showing up, check whether the host's admin
bundle is older than your plugin build before looking anywhere else.

---

## Testing

```bash
npm run test:unit          # vitest unit suite
npm run test:unit:watch    # watch mode
npm run test:ts:back       # typecheck the server
npm run test:ts:front      # typecheck the admin
```

Two suites need a live Strapi with MCP enabled and an admin token:

```bash
npm run test:e2e           # structural: tools/list shape, scoping, tool-guide resource
E2E_LIVE=1 npm run test:e2e:live   # makes real API calls

# per-tool permission scoping against a live server; mints and deletes its own tokens
STRAPI_URL=http://localhost:1337 ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... \
  npm run test:mcp-scoping
```

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — system architecture, lifecycle,
  data flows
- [`docs/plugin-contract.md`](./docs/plugin-contract.md) — the `ai-tools` contract
  for plugin authors
- [`docs/guardrails.md`](./docs/guardrails.md) — guardrail internals, patterns, and
  the MCP gap

## License

MIT
