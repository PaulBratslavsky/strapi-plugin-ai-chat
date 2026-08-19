# Strapi Plugin AI SDK

A Strapi v5 plugin that adds an AI-powered chat assistant to the admin panel, exposes AI endpoints for frontend apps (Next.js, etc.), and exposes its tools to external AI clients over Strapi's official MCP server (Strapi >= 5.47). Built on [Vercel AI SDK](https://ai-sdk.dev/) with [Anthropic Claude](https://www.anthropic.com/) as the default provider.

## Features

- **Admin Chat UI** with markdown rendering, tool call visualization, conversation history, and memory management
- **Content Tools** -- the AI can list content types, search content, create/update documents, and send emails
- **API Endpoints** -- `/ask`, `/ask-stream`, and `/chat` for frontend consumption (compatible with `useChat` from `@ai-sdk/react`)
- **Public Chat** -- sandboxed public-facing chat with read-only tools and a separate public memory store
- **Embeddable Widget** -- drop a single `<script>` tag on any website to add an AI chat bubble
- **MCP** -- exposes its tools to external AI clients (Claude Desktop, Cursor, etc.) over Strapi's official built-in MCP server (Strapi >= 5.47, admin-token authenticated)
- **Guardrails** -- regex-based input safety middleware that blocks prompt injection, jailbreaks, and destructive commands
- **Extensible** -- register custom tools and AI providers at runtime

## Quick Start

### 1. Install and enable

In your Strapi project's `config/plugins.ts`:

```typescript
export default ({ env }) => ({
  'ai-sdk': {
    enabled: true,
    resolve: 'src/plugins/ai-sdk', // or the npm package path
    config: {
      anthropicApiKey: env('ANTHROPIC_API_KEY'),
      chatModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5'),
    },
  },
});
```

### 2. Set environment variables

```bash
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
ANTHROPIC_MODEL=claude-sonnet-5  # optional
```

### 3. Build and start

```bash
npm run build
npm run develop
```

### 4. Enable permissions

In the Strapi admin panel:

1. Go to **Settings > Users & Permissions > Roles**
2. Select **Public** (or your desired role)
3. Under **Ai-sdk**, enable `ask`, `askStream`, and `chat`
4. Save

## Embeddable Chat Widget

Add a floating AI chat bubble to **any website** with a single script tag. No npm install, no build step, no React required.

### 1. Enable the public chat endpoint

In the Strapi admin panel:

1. Go to **Settings > Users & Permissions > Roles > Public**
2. Under **Ai-sdk**, enable `publicChat` and `serveWidget`
3. Save

### 2. Add the script tag

```html
<script src="https://your-strapi-url.com/api/ai-sdk/widget.js"></script>
```

That's it. A floating chat button appears in the bottom-right corner. The widget auto-detects its Strapi URL from the script `src`.

### Configuration via data attributes

```html
<script
  src="https://your-strapi-url.com/api/ai-sdk/widget.js"
  data-api-token="your-api-token"
  data-system-prompt="You are a helpful assistant for our store."
></script>
```

| Attribute | Description |
|-----------|-------------|
| `data-api-token` | Optional API token for authenticated requests |
| `data-system-prompt` | Override the default system prompt |

### How it works

- The widget bundles React and AI SDK internally (~130KB gzipped)
- It renders inside a Shadow DOM so styles never conflict with your page
- It uses the `/api/ai-sdk/public-chat` endpoint which only exposes read-only tools

### Public Chat vs Admin Chat

| Feature | Admin Chat (`/chat`) | Public Chat (`/public-chat`) |
|---------|---------------------|------------------------------|
| Authentication | Admin JWT required | None (public endpoint) |
| Tools available | All tools (read + write) | Read-only tools only |
| Memory store | Per-user private memories | Shared public memories |
| Content access | All content types | Only configured `allowedContentTypes` |

### Configuring public chat

In `config/plugins.ts`, add `publicChat` with the content types visitors can query:

```typescript
'ai-sdk': {
  enabled: true,
  config: {
    anthropicApiKey: env('ANTHROPIC_API_KEY'),
    publicChat: {
      chatModel: 'claude-haiku-4-5-20251001', // optional: use a cheaper model for public chat
      allowedContentTypes: [
        'api::article.article',
        'api::category.category',
        'api::product.product',
      ],
    },
  },
},
```

If `allowedContentTypes` is an empty array, public chat will have no access to content.

### Managing public memories

Public memories are facts the AI knows when talking to visitors (e.g., "Our return policy is 30 days"). Manage them from the Strapi admin panel:

1. Go to the **AI SDK** plugin page
2. Click the globe icon in the chat toolbar
3. Add, edit, or delete public memories with categories: General, FAQ, Product, Policy

## Configuration

All plugin settings go in `config/plugins.ts` under the `ai-sdk` key:

```typescript
export default ({ env }) => ({
  'ai-sdk': {
    enabled: true,
    config: {
      // AI Provider (required)
      apiKey: env('AI_API_KEY'),                    // provider-neutral (preferred)
      // anthropicApiKey: env('ANTHROPIC_API_KEY'),  // deprecated alias, still works as a fallback
      provider: 'anthropic',                        // default; or 'openai-compatible' for local models
      chatModel: 'claude-sonnet-5',        // default
      baseURL: undefined,                           // required for provider: 'openai-compatible'

      // System Prompt (optional)
      systemPrompt: 'You are a helpful CMS assistant.\n\n{tools}',

      // Public Chat (optional)
      publicChat: {
        chatModel: 'claude-haiku-4-5-20251001',     // optional cheaper model
        allowedContentTypes: ['api::article.article'],
      },

      // Guardrails (optional)
      guardrails: {
        enabled: true,                               // default
        maxInputLength: 10000,                       // default
        additionalPatterns: [],                      // extra regex patterns
        disableDefaultPatterns: false,                // use only your own patterns
        blockedMessage: 'Custom blocked message.',   // override default message
      },
    },
  },
});
```

There is no MCP configuration here — MCP is enabled at the **Strapi** level
(`mcp: { enabled: true }` in the host's `config/server.ts`), not under this
plugin's config. See [MCP Server](#mcp-server) below.

### Anthropic models

Verified against the Anthropic API on 2026-08-18:

- `claude-sonnet-5` (default)
- `claude-opus-5`
- `claude-fable-5`
- `claude-haiku-4-5-20251001` (public chat default — cheaper, higher rate limits)

This is a reference list, not an allowlist. `chatModel` accepts any string, so
newer Anthropic ids work without a plugin update — as do local model ids such as
`gemma4:26b` when using the `openai-compatible` provider.

**Prefer undated aliases** (`claude-sonnet-5`) over dated snapshots
(`claude-sonnet-4-20250514`). Anthropic retires dated snapshots, and every dated
id this plugin previously shipped had been retired — which silently broke chat
for anyone running the defaults.

### Bring your own model (local / self-hosted)

CMS data never has to leave your infrastructure. The plugin ships a built-in
`openai-compatible` provider that works with any OpenAI-compatible local
runtime -- Ollama, vLLM, LM Studio, LocalAI -- with config only, no code:

```typescript
// config/plugins.ts
export default ({ env }) => ({
  'ai-sdk': {
    enabled: true,
    config: {
      provider: 'openai-compatible',
      baseURL: env('AI_BASE_URL', 'http://localhost:11434/v1'), // Ollama's OpenAI-compatible endpoint
      apiKey: env('AI_API_KEY', 'ollama'),                      // most local runtimes ignore this value but require it be set
      chatModel: env('AI_MODEL', 'llama3.1'),
    },
  },
});
```

`baseURL` is required when `provider` is `'openai-compatible'` -- the plugin
fails fast with an actionable error at config-validation time (and again at
first model use) rather than silently defaulting to a hosted API.

For any other model host, register your own provider creator instead of
forking the plugin -- see [Adding an AI Provider](#adding-an-ai-provider) below.

## API Endpoints

### Content API (for frontend apps)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ai-sdk/ask` | Non-streaming text generation |
| `POST` | `/api/ai-sdk/ask-stream` | Streaming text via Server-Sent Events |
| `POST` | `/api/ai-sdk/chat` | Chat with AI SDK UI message stream protocol |
| `POST` | `/api/ai-sdk/public-chat` | Public chat with read-only tools and public memories |
| `GET` | `/api/ai-sdk/widget.js` | Embeddable chat widget script |

MCP is no longer served by this plugin — see [MCP Server](#mcp-server) below for the current `/mcp` endpoint, which is served by Strapi itself.

### Admin API (admin panel only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/ai-sdk/chat` | Admin chat with full tool access |

All routes with user input are protected by the guardrail middleware.

### POST `/api/ai-sdk/ask`

Generate a text response (non-streaming).

**Request:**

```json
{
  "prompt": "What is the capital of France?",
  "system": "You are a helpful geography assistant."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The user's question or prompt |
| `system` | string | No | System prompt override |

**Response:**

```json
{
  "data": {
    "text": "The capital of France is Paris."
  }
}
```

### POST `/api/ai-sdk/ask-stream`

Streaming text generation via Server-Sent Events.

**Request:** Same as `/ask`

**Response:** SSE stream

```
data: {"text":"The"}
data: {"text":" capital"}
data: {"text":" of France is Paris."}
data: [DONE]
```

### POST `/api/ai-sdk/chat`

Chat endpoint using the AI SDK UI message stream protocol. Compatible with the `useChat` hook from `@ai-sdk/react`. Supports multi-turn conversation with tool calling.

**Request:**

```json
{
  "messages": [
    { "role": "user", "content": "Hello!" },
    { "role": "assistant", "content": "Hi there! How can I help you?" },
    { "role": "user", "content": "List all my content types" }
  ],
  "system": "You are a helpful assistant."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | array | Yes | Array of message objects with `role` and `content` |
| `system` | string | No | System prompt override |

**Response:** UI message stream (`x-vercel-ai-ui-message-stream: v1` protocol) with text deltas and tool call events.

## Built-in Tools

The AI assistant has access to these tools. Tools marked as **public** are also exposed via MCP.

| Tool | MCP Name | Description |
|------|----------|-------------|
| `listContentTypes` | `list_content_types` | List all Strapi content types and components with their fields and relations |
| `searchContent` | `search_content` | Search and query any content type with filters, sorting, and pagination |
| `findOneContent` | `find_one_content` | Fetch a single document by ID |
| `aggregateContent` | `aggregate_content` | Count, group, and analyze content (faster than searchContent for analytics) |
| `createContent` | `create_content` | Create a new document in any content type |
| `updateContent` | `update_content` | Update an existing document in any content type |
| `uploadMedia` | `upload_media` | Upload a media file (from a URL or base64) to the Media Library |
| `sendEmail` | `send_email` | Send emails via the configured email provider (e.g. Resend) |

These 8 tools are the ones exposed over MCP (see [MCP Server](#mcp-server)); the plugin also has chat-only tools (memory, notes, tasks) that never leave the admin/public chat paths. Additionally, the AI SDK automatically discovers tools from other installed extension plugins — see [`docs/plugin-contract.md`](./docs/plugin-contract.md) for the discovery contract. For example, with `strapi-plugin-ai-sdk-yt-transcripts` and `strapi-plugin-ai-sdk-yt-embeddings` installed, the AI also has access to transcript fetching/search tools and semantic YouTube-knowledge search.

### Tool Details

**searchContent** parameters: `contentType` (required), `query`, `filters`, `fields`, `sort`, `page`, `pageSize` (max 50)

**createContent** / **updateContent** parameters: `contentType` (required), `documentId` (required for update), `data` (required), `status` (`draft` or `published`)

**sendEmail** parameters: `to` (required), `subject` (required), `html` (required), `text`, `cc`, `bcc`, `replyTo`. The tool always confirms the recipient with the user before sending. See [docs/sending-emails-with-resend.md](./docs/sending-emails-with-resend.md) for setup.

## MCP Server

As of `v1.1.0`, MCP is served by **Strapi itself** — the plugin no longer runs
its own MCP server, sessions, or transport. It registers its tools onto
Strapi's official built-in MCP server (`strapi.ai.mcp`, Strapi >= 5.47),
which serves a single endpoint at `/mcp` for the whole application.

This is a breaking change from pre-1.1.0 versions. If you're upgrading, read
[Migrating from 0.x](#migrating-from-0x) below before touching client
configs.

### Requirements

- **Strapi >= 5.47.0**
- The host app's own `config/server.ts` must set `mcp: { enabled: true }` —
  the plugin cannot turn this on for you:

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

- An **Admin API token** (not a Content API token — see below) whose role
  grants the `plugin::ai-sdk.mcp.*` permission(s) for the tools you want to
  reach.

### How It Works

- The plugin's `ToolRegistry` is unchanged — it still backs the admin chat
  and public widget. At boot, `registerAiSdkMcpTools()` additionally walks
  every non-internal tool in the registry and calls
  `strapi.ai.mcp.registerTool()` for it.
- Tool names are converted from the registry's camelCase/namespaced form to
  snake_case (`searchContent` -> `search_content`,
  `ai-sdk-yt-transcripts__fetchTranscript` ->
  `ai_sdk_yt_transcripts__fetch_transcript`).
- Each tool is gated by **its own** admin permission action —
  `plugin::<owning-plugin>.tool.<slug>`, e.g.
  `plugin::ai-sdk.tool.search-content` or
  `plugin::ai-sdk-yt-transcripts.tool.fetch-transcript`. A caller only sees
  tools it has been granted; permission gating filters `tools/list` itself,
  not just execution. Tools contributed by another plugin register their
  actions under **that plugin's** section, not ai-sdk's.
- Schemas are handed to the SDK as plain Zod 4 objects — no custom
  Zod-to-JSON-Schema converter. A handful of this plugin's own array/object
  parameters are wrapped in `jsonCoercible()` so stringified JSON arguments
  (e.g. `fields: '["title"]'` from `mcp-remote`) still parse; that tolerance
  is **not** automatic for third-party tools' object/array parameters — see
  [`docs/plugin-contract.md`](./docs/plugin-contract.md#6-zod-rules).
- A tool that fails to register (e.g. a name collision with one of Strapi's
  own auto-derived CRUD tools) is skipped with a warning; it does not break
  Strapi's boot.
- Strapi's own auto-generated content tools (`list_<type>`, `get_<type>`,
  etc.) appear on the same `/mcp` endpoint, alongside this plugin's tools.
  There's no way to disable the built-ins; gate exposure by only granting the
  permissions you want a given token to reach.
- There is no server-level `instructions` hook to advertise "what this server
  is for" during `initialize` — see
  [`docs/plugin-contract.md`](./docs/plugin-contract.md#7-server-instructions-are-gone-partial-mitigation-only)
  for what replaced it and why it's a partial mitigation, not a full one.

For the full contract — the `ai-tools` service shape, `ToolDefinition`,
namespacing, Zod rules, and per-tool permissions — see
[`docs/plugin-contract.md`](./docs/plugin-contract.md).

### Setup

#### 1. Enable MCP on the host

Set `mcp: { enabled: true }` in `config/server.ts` (see Requirements above)
and restart Strapi. Check the log line at boot:

```
[ai-sdk:mcp] Registered 8 tool(s) on the official MCP server.
```

If instead you see
`[ai-sdk:mcp] Official MCP server not enabled — skipping tool registration.`,
either the Strapi version is below 5.47 or `mcp.enabled` is not set.

#### 2. Grant permissions to an Admin API token

MCP authenticates with **Admin API tokens**, not Content API tokens:

1. Go to **Settings → Administration Panel → API Tokens**
2. Create a new token (or edit an existing one)
3. Under **Permissions**, tick the individual tools this token should reach.
   Each plugin contributing tools gets its own section — built-ins under
   **Ai sdk**, contributed tools under their own plugin's name.
4. Copy the token

Scoping is per tool, so a token granted only `search-content` and
`list-content-types` gets a genuinely browse-only surface — every other tool
is absent from `tools/list` for that token, not merely refused on execution.

Tick deliberately: some tools cost money or hit an external API per call
(the YouTube plugins' `fetch-transcript` and `search-yt-knowledge`) even
though they mutate nothing. Each tool's `access` metadata (`read` / `write`
/ `destructive`) is a hint about that risk, but it no longer grants anything
— what a token can do is exactly what you tick.

#### 3. Connect your AI client

The MCP endpoint URL is:

```
http://localhost:1337/mcp
```

For remote deployments, replace `localhost:1337` with your Strapi URL.

### Connecting from Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "strapi": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:1337/mcp",
        "--header",
        "Authorization: Bearer YOUR_STRAPI_ADMIN_TOKEN"
      ]
    }
  }
}
```

Restart Claude Desktop after saving the config.

### Connecting from Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "strapi": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:1337/mcp",
        "--header",
        "Authorization: Bearer YOUR_STRAPI_ADMIN_TOKEN"
      ]
    }
  }
}
```

Or run: `claude mcp add strapi -- npx mcp-remote http://localhost:1337/mcp --header "Authorization: Bearer YOUR_STRAPI_ADMIN_TOKEN"`

### Connecting from Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "strapi": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:1337/mcp",
        "--header",
        "Authorization: Bearer YOUR_STRAPI_ADMIN_TOKEN"
      ]
    }
  }
}
```

### Testing with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:1337/mcp` with a `Streamable HTTP` transport and
an `Authorization: Bearer YOUR_STRAPI_ADMIN_TOKEN` header, then browse
`tools/list` and the `strapi://ai-sdk/tools/guide` resource.

### Migrating from 0.x

Every existing MCP client config breaks on upgrade to `v1.1.0`. There is no
backward-compatible shim — this was a hard cutover, not a gradual migration.

1. **Endpoint moved.** `/api/ai-sdk/mcp` (this plugin) is gone. MCP now lives
   at `/mcp`, served by Strapi itself, shared across the whole application
   (including any other plugins' MCP tools and Strapi's own auto-generated
   content tools).

2. **Auth changed from Content API tokens to Admin API tokens.** A Content
   API token that worked against `/api/ai-sdk/mcp` will not authenticate
   against `/mcp` at all. You need an **Admin API token** (Settings →
   Administration Panel → API Tokens), and that token's role must be granted
   the individual `plugin::<owner>.tool.<slug>` permissions for the tools it
   should reach — there is no "Ai-sdk: handle" permission to carry forward;
   it's gone along with the old controller. (Interim releases briefly used
   four `plugin::ai-sdk.mcp.*` tier actions; those are gone too.)

   Before:
   ```json
   {
     "mcpServers": {
       "strapi": {
         "command": "npx",
         "args": ["mcp-remote", "http://localhost:1337/api/ai-sdk/mcp",
           "--header", "Authorization: Bearer YOUR_CONTENT_API_TOKEN"]
       }
     }
   }
   ```
   After:
   ```json
   {
     "mcpServers": {
       "strapi": {
         "command": "npx",
         "args": ["mcp-remote", "http://localhost:1337/mcp",
           "--header", "Authorization: Bearer YOUR_STRAPI_ADMIN_TOKEN"]
       }
     }
   }
   ```

3. **Server `instructions` are gone.** Clients that decided whether to
   activate this server based on the old dynamic `/youtube`, `/octalens`
   -style routing hints in `instructions` no longer get that signal — there
   is no hook for a plugin to set `instructions` on Strapi's server. The
   closest replacement is the `strapi://ai-sdk/tools/guide` resource, but a
   resource is only readable *after* a client has already activated the
   server, so it does not recreate the old activation-time behavior. See
   [`docs/plugin-contract.md`](./docs/plugin-contract.md#7-server-instructions-are-gone-partial-mitigation-only).

4. **Stringified JSON arguments are no longer tolerated everywhere.** The old
   server JSON-parsed any stringified array/object argument for *any*
   registered tool before running it. The official server validates
   arguments before the handler runs, so that generic tolerance is gone.
   This plugin's own array/object parameters (`filters`, `fields`,
   `populate`, `data` on `searchContent`, `findOneContent`,
   `aggregateContent`, `createContent`, `updateContent`) still accept a
   JSON-string form via a `jsonCoercible()` wrapper on those specific
   parameters — but **third-party tools' object/array parameters get no
   automatic coercion** unless that tool's author opts in the same way. If
   you maintain an extension plugin and rely on `mcp-remote` clients sending
   `tags: '["a","b"]'` instead of `tags: ["a","b"]`, wrap that parameter's
   schema in `jsonCoercible()` yourself — see
   [`docs/plugin-contract.md`](./docs/plugin-contract.md#jsoncoercible--opting-an-arrayobject-param-into-json-string-tolerance).

5. **MCP tool calls stopped being guardrail-screened.** Before `v1.1.0`,
   `POST /api/ai-sdk/mcp` carried this plugin's own guardrail middleware, so
   MCP tool-call arguments were checked against the same prompt-injection /
   jailbreak / destructive-command patterns as chat and `/ask` traffic. As of
   `v1.1.0`, `/mcp` is served by Strapi core — this plugin has no route or
   controller there, so there is nothing to attach a middleware to. **This
   protection is genuinely gone, with no config flag to restore it.** The
   admin-token authentication and per-tool `plugin::<owner>.tool.<slug>`
   permissions are real mitigations, but they gate *who can call which
   tools*, not *what a call's arguments contain* — they are not a substitute
   for content screening. A central middleware layer does exist for anyone
   who needs this — `strapi.server.use()` mounts a global Koa middleware
   upstream of `/mcp` — but this plugin does not ship one. See
   [`docs/guardrails.md`](./docs/guardrails.md#mcp-tool-calls-are-not-guardrail-screened)
   for the full explanation.

## Guardrails

The plugin includes a guardrail middleware that checks user input before it reaches the AI. It runs on `/ask`, `/ask-stream`, `/chat`, and `/public-chat` (the public widget endpoint is screened using the same extraction logic as `/chat`). It does **not** run on `/mcp` — that endpoint is served by Strapi itself, not by this plugin's routes, so MCP tool calls are not guardrail-checked — see [`docs/guardrails.md`](./docs/guardrails.md#overview) for details.

### What It Catches

- **Prompt injection** -- "ignore all previous instructions", "override your rules"
- **Jailbreak attempts** -- "you are now in developer mode", "DAN mode"
- **System prompt extraction** -- "reveal your system prompt", "what were you told"
- **System prompt mimicry** -- fake `[SYSTEM]:` delimiters injected in user input
- **Destructive commands** -- "delete all content", "drop table", "rm -rf"

### How It Works

1. Extract user input (adapts to request shape: `messages` for `/chat`/`/public-chat`, `prompt` for `/ask`/`/ask-stream`)
2. Run optional `beforeProcess` hook (for custom logic like external moderation APIs)
3. Normalize text (NFKC, strip zero-width characters, collapse whitespace)
4. Match against compiled regex patterns
5. Check input length (default max: 10,000 characters)

Blocked requests return route-aware responses: chat routes get an SSE message (renders naturally in the UI), API routes get a 403 JSON error.

For full details, pattern lists, and the `beforeProcess` hook API, see [docs/guardrails.md](./docs/guardrails.md).

## Frontend Integration (Next.js)

### Using `useChat` (Recommended)

The `/chat` endpoint is fully compatible with the `useChat` hook from `@ai-sdk/react`:

```bash
npm install @ai-sdk/react
```

```tsx
'use client';

import { useChat } from '@ai-sdk/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: 'http://localhost:1337/api/ai-sdk/chat',
  });

  return (
    <div>
      <div>
        {messages.map((message) => (
          <div key={message.id}>
            <strong>{message.role}:</strong> {message.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
```

### Non-streaming request

```typescript
const response = await fetch('http://localhost:1337/api/ai-sdk/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Explain quantum computing in simple terms',
  }),
});

const { data } = await response.json();
console.log(data.text);
```

### Streaming request

```typescript
const response = await fetch('http://localhost:1337/api/ai-sdk/ask-stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Write a short story about a robot' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

  for (const line of lines) {
    const data = line.replace('data: ', '');
    if (data === '[DONE]') continue;
    const { text } = JSON.parse(data);
    process.stdout.write(text);
  }
}
```

### cURL

```bash
# Non-streaming
curl -X POST http://localhost:1337/api/ai-sdk/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, how are you?"}'

# Streaming
curl -N -X POST http://localhost:1337/api/ai-sdk/ask-stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Count from 1 to 10"}'
```

## Extending the Plugin

### Adding Tools from Other Plugins (Convention-Based Discovery)

Any Strapi plugin can contribute tools to the AI SDK by exposing an `ai-tools` service with a `getTools()` method. The AI SDK discovers these automatically at boot time -- no configuration required.

```mermaid
flowchart LR
  subgraph "AI SDK Bootstrap"
    B[Scan all plugins]
  end

  subgraph "Plugin A"
    A1[ai-tools service] --> A2["getTools()"]
  end

  subgraph "Plugin B"
    B1[ai-tools service] --> B2["getTools()"]
  end

  B --> A1
  B --> B1
  A2 --> R[ToolRegistry]
  B2 --> R
  R --> Chat[Admin Chat]
  R --> MCP[MCP Server]
  R --> Public[Public Chat]
```

#### How It Works

1. On startup, the AI SDK scans every loaded plugin for an `ai-tools` service
2. If found, it calls `getTools()` which returns an array of `ToolDefinition` objects
3. Each tool is namespaced as `pluginName__toolName` (e.g., `octalens-mentions__searchMentions`) to prevent collisions — hyphens in the plugin id are preserved here and only converted to underscores later, for MCP (see step 5)
4. Discovered tools are registered in the shared `ToolRegistry` alongside built-in tools
5. All non-`internal` registered tools are available in admin chat, public chat (if `publicSafe: true`), and — when the host has enabled MCP (Strapi >= 5.47, `mcp: { enabled: true }`) and the connecting Admin API token's role grants the matching `plugin::ai-sdk.mcp.*` permission — on MCP, as a snake_cased, namespace-prefixed tool name (e.g. `octalens_mentions__search_mentions`)

#### Creating an `ai-tools` Service in Your Plugin

**1. Define canonical tools** in `server/src/tools/`:

```typescript
// server/src/tools/my-tool.ts
import { z } from 'zod';
import type { Core } from '@strapi/strapi';

const schema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().min(1).max(50).optional().default(10).describe('Max results'),
});

export const mySearchTool = {
  name: 'mySearch',
  description: 'Search my plugin data with relevance ranking.',
  schema,
  execute: async (args: z.infer<typeof schema>, strapi: Core.Strapi) => {
    const validated = schema.parse(args);
    const results = await strapi.documents('plugin::my-plugin.item' as any).findMany({
      filters: { title: { $containsi: validated.query } },
      limit: validated.limit,
    });
    return { results, total: results.length };
  },
  publicSafe: true, // available in public chat (read-only operations)
};
```

**2. Create the `ai-tools` service with optional `getMeta()`:**

```typescript
// server/src/services/ai-tools.ts
import type { Core } from '@strapi/strapi';
import { tools } from '../tools';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  getTools() {
    return tools;
  },

  /**
   * Optional: feeds the `strapi://ai-sdk/tools/guide` MCP resource, where
   * your plugin gets its own labeled section with a description and
   * keywords. Note this is a resource, not server `instructions` — a client
   * only sees it after already connecting, not before deciding whether to
   * activate the server. Without getMeta(), your tools still appear on the
   * guide, just grouped under the raw plugin id instead of a friendly label.
   */
  getMeta() {
    return {
      label: 'My Plugin',
      description: 'Search and manage my plugin data with relevance ranking',
      keywords: ['/my-plugin', 'my data', 'search my stuff'],
    };
  },
});
```

**3. Register the service:**

```typescript
// server/src/services/index.ts
import myService from './my-service';
import aiTools from './ai-tools';

export default {
  'my-service': myService,
  'ai-tools': aiTools,
};
```

That's it. The AI SDK will discover and register your tools on the next Strapi restart.

#### ToolDefinition Interface

```typescript
interface ToolDefinition {
  name: string;                    // camelCase, unique within your plugin
  description: string;             // Clear description for the AI model
  schema: z.ZodObject<any>;        // Zod schema for parameter validation
  execute: (args: any, strapi: Core.Strapi, context?: ToolContext) => Promise<unknown>;
  internal?: boolean;              // If true, hidden from MCP (AI chat only)
  publicSafe?: boolean;            // If true, available in public/widget chat; also the default MCP tier is 'read' when true
  access?: 'read' | 'write' | 'destructive' | 'maintenance'; // MCP permission tier override; defaults to 'read' if publicSafe else 'write'. 'maintenance' (expensive / external-API-cost) is never derived — set it explicitly.
}
```

**Zod note:** import `z` from your own `zod` package dependency — never from
`@strapi/utils`. Both are Zod 4, but the MCP SDK's schema converter reads
`.describe()` text from a per-instance registry; a schema built with
`@strapi/utils`'s re-exported `z` is invisible to that registry and every
parameter description silently vanishes in `tools/list`. See
[`docs/plugin-contract.md`](./docs/plugin-contract.md#6-zod-rules) for the
full explanation, plus the `jsonCoercible()` helper for opting an
array/object parameter into stringified-JSON tolerance.

#### ToolSourceMeta Interface (optional `getMeta()`)

When your plugin provides `getMeta()` on its `ai-tools` service, your tools
get a labeled section — with description and keywords — in the
`strapi://ai-sdk/tools/guide` MCP resource, instead of being grouped under
the raw plugin id. This is **not** the same as the old MCP server
`instructions` string (there is no such hook in Strapi's official server) —
a resource is only readable after a client has already connected, so it does
not influence whether a client like Claude Desktop decides to activate the
server in the first place. It's still useful for an already-connected agent
deciding which tool to call, or a human browsing capabilities via an
inspector.

Without `getMeta()`, your tools are still registered and reachable — they
just appear under the raw plugin id (e.g. `octalens-mentions`) rather than a
friendly label in the guide.

```typescript
interface ToolSourceMeta {
  label: string;          // Human-readable label, e.g. "YouTube Transcripts"
  description: string;    // One-line capability summary for the tool guide
  keywords?: string[];    // Displayed alongside the description, e.g. ["/youtube", "/yt", "transcript"]
}
```

#### Canonical Architecture Pattern

Your plugin needs **no MCP code at all** — no server, no transport, no
per-protocol wrapper. Define each tool once in `server/src/tools/` (Zod
schema + business logic) and expose the array through your `ai-tools`
service; `strapi-plugin-ai-sdk` bridges it onto every surface itself:

```mermaid
flowchart TB
  subgraph "Your Plugin"
    T["server/src/tools/<br/>Canonical tool definitions<br/>(Zod schema + business logic)"]
    S["services/ai-tools.ts<br/>getTools() → tools array"]
    T --> S
  end

  subgraph "strapi-plugin-ai-sdk"
    R["ToolRegistry<br/>(namespaced at discovery)"]
    Bridge["mcp/register-tools.ts<br/>strapi.ai.mcp.registerTool()"]
    R --> Bridge
  end

  S -->|"discovered at boot"| R
  R --> Chat["Admin Chat"]
  R --> Widget["Public Widget (if publicSafe)"]
  Bridge -->|"tools/call"| MCPCore["strapi.ai.mcp (Strapi core, /mcp)"]
  MCPCore --> Clients["Claude Desktop / Cursor / etc."]
```

This eliminates duplication -- business logic lives in one place, and the hub
plugin is the only thing that ever touches MCP. If you're maintaining an
older plugin that still runs its own MCP server and transport code, that's
the pattern this replaces — see
[`docs/mcp-consolidation.md`](./docs/mcp-consolidation.md) for the migration
guide.

#### Real-World Examples

Two plugins already use this pattern:

**[strapi-octolens-mentions-plugin](../strapi-octolens-mentions-plugin/)** -- Contributes 4 tools: `searchMentions` (BM25 relevance search), `listMentions`, `getMention`, `updateMention`

**[strapi-content-embeddings](../strapi-content-embeddings/)** -- Contributes 5 tools: `semanticSearch` (vector similarity), `ragQuery` (RAG), `listEmbeddings`, `getEmbedding`, `createEmbedding`

### Adding a Custom Tool (Without a Plugin)

**Option A: Inside the plugin** -- create files in `tools/definitions/` and `tool-logic/`, add to the `builtInTools` array.

**Option B: At runtime from your Strapi app:**

```typescript
// src/index.ts (your Strapi app)
import { z } from 'zod';

export default {
  bootstrap({ strapi }) {
    const plugin = strapi.plugin('ai-sdk');
    plugin.toolRegistry.register({
      name: 'analyzeContent',
      description: 'Analyze content quality and suggest improvements',
      schema: z.object({
        contentType: z.string().describe('Content type UID'),
        documentId: z.string().describe('Document ID to analyze'),
      }),
      execute: async (args, strapi) => {
        const doc = await strapi.documents(args.contentType).findOne({
          documentId: args.documentId,
        });
        return { score: 85, suggestions: ['Add more headings'] };
      },
    });
  },
};
```

The tool is automatically available in AI chat and, on the next Strapi restart, MCP (unless `internal: true`) — gated by its own `plugin::<owner>.tool.<slug>` action, registered automatically under the owning plugin's section. No changes to `tools/index.ts` or `mcp/register-tools.ts` needed. The new action starts **ungranted**: tick it on a role (for chat) or a token (for MCP) before the tool becomes reachable.

### Adding an AI Provider

The `openai-compatible` provider built into the plugin (see
[Bring your own model](#bring-your-own-model-local--self-hosted) above)
covers most local/self-hosted runtimes with config alone. For anything else
-- a provider with a different request shape, a managed API the plugin
doesn't know about -- register your own creator through the plugin's
`provider` service. This is the supported way to reach `AIProvider`: the
package's `exports` map does not expose deep imports like
`strapi-plugin-ai-sdk/server`, by design.

```typescript
// src/index.ts (your Strapi app)
import { createOpenAI } from '@ai-sdk/openai';

export default {
  register({ strapi }) {
    strapi.plugin('ai-sdk').service('provider').register(
      'openai',
      ({ apiKey, baseURL }) => {
        const provider = createOpenAI({ apiKey, baseURL });
        return (modelId: string) => provider(modelId);
      }
    );
  },
};
```

Then set `provider: 'openai'` and `chatModel: 'gpt-4o'` in config.

Registration can happen in either `register()` or `bootstrap()` of your
Strapi app -- the plugin resolves the named provider **lazily, on first
model use**, not during its own bootstrap. So even though Strapi runs plugin
bootstraps before the host app's bootstrap, registering later than the
plugin's own bootstrap is fine. If the named provider is still unregistered
by the time a request actually needs a model, you get a clear error listing
what *is* registered, rather than a silent failure.

### Customizing the System Prompt

```typescript
// config/plugins.ts
config: {
  // Simple replacement (tool descriptions appended automatically)
  systemPrompt: 'You are a friendly content editor for our blog platform.',

  // Or use {tools} placeholder for precise placement
  systemPrompt: `You are a blog assistant.

RULES:
- Always use friendly language
- Never create content without confirmation

{tools}

When listing content types, summarize them in a table.`,
}
```

Per-request `system` overrides in the request body take priority over the configured `systemPrompt`.

## Admin Panel Features

The plugin adds a chat interface to the Strapi admin panel with:

- **Chat UI** -- message list with markdown rendering, tool call visualization, and typing indicator
- **Conversation History** -- persistent conversations stored per-user, accessible via the sidebar
- **Memory Management** -- the AI remembers facts across conversations; view and manage memories from the toolbar
- **Public Memory Store** -- shared facts available to public chat visitors (FAQ, policies, etc.)
- **Tool Call Display** -- collapsible viewer showing tool inputs and outputs inline in the chat
- **Widget Preview** -- live preview of the embeddable chat widget with copy-paste embed code
- **Model Badge** -- the chat header shows the active model and whether inference is
  **Local** or **Hosted**, so it is obvious at a glance whether content is leaving your
  infrastructure. Backed by `GET /ai-sdk/model-info`, which reads `provider`, `chatModel`
  and `baseURL` from plugin config. "Local" is derived from the **baseURL host** (loopback
  or private range), not the provider name — `openai-compatible` also covers hosted
  OpenAI-compatible APIs, and a privacy claim should not be inferred from a label.

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `prompt is required` | Missing prompt in request | Include `prompt` in request body |
| `AI SDK not initialized` | Missing API key | Check `ANTHROPIC_API_KEY` in `.env` |
| `403 Forbidden` | Permissions not enabled | Enable permissions in Strapi admin |
| `Request blocked by guardrails` | Input matched a safety pattern | Rephrase the prompt |

Error response format:

```json
{
  "error": {
    "status": 400,
    "name": "BadRequestError",
    "message": "prompt is required and must be a string"
  }
}
```

## Project Structure

```
server/src/
  index.ts                    # Server entry point
  register.ts                 # Plugin register lifecycle
  bootstrap.ts                # Initialize providers, tools, MCP, plugin tool discovery
  destroy.ts                  # Graceful shutdown
  config/index.ts             # Plugin config defaults
  guardrails/                 # Input safety middleware
  lib/
    ai-provider.ts            # AIProvider with static provider registry
    tool-registry.ts          # ToolRegistry class
    types.ts                  # Shared types
    utils.ts                  # Controller helpers
  controllers/
    controller.ts             # ask, askStream, chat, publicChat, serveWidget handlers
    public-memory.ts          # CRUD for public memories
    # no mcp.ts — MCP has no controller in this plugin; /mcp is served by Strapi core
  services/service.ts         # AI service facade
  routes/
    content-api/index.ts      # Public API routes (/mcp is not one of them)
    admin/index.ts            # Admin routes
  tools/
    index.ts                  # Bridge: registry -> AI SDK ToolSet
    definitions/              # Tool definitions (schema + execute wrapper)
  tool-logic/                 # Pure business logic (shared by AI SDK + MCP)
  mcp/                        # Bridge onto Strapi's official MCP server (v1.1.0+)
    index.ts                  # registerAiSdkMcpTools() — entry point, called from bootstrap.ts
    permissions.ts             # registers plugin::ai-sdk.mcp.{read,write,destructive,maintenance}
    register-tools.ts          # walks registry.getPublic(), calls strapi.ai.mcp.registerTool()
    register-resources.ts      # registers the strapi://ai-sdk/tools/guide resource
    access.ts                  # read/write/destructive/maintenance tier derivation
    naming.ts                  # camelCase/namespace -> MCP snake_case name conversion
    size-guard.ts              # ~1MB wire-size backstop
    resources/tool-guide.ts    # tool-guide markdown generator
    utils/sanitize.ts          # Content API sanitization

admin/src/
  pages/                      # App router, HomePage, WidgetPreviewPage, MemoryStorePage
  components/
    Chat.tsx                  # Chat orchestrator
    MessageList.tsx           # Message rendering with markdown
    ChatInput.tsx             # Input area
    ToolCallDisplay.tsx       # Tool call viewer
    ConversationSidebar.tsx   # Conversation history panel
    MemoryPanel.tsx           # Memory management panel
  hooks/
    useChat.ts                # Chat state + SSE streaming
    useConversations.ts       # Conversation CRUD
    useMemories.ts            # Memory CRUD

widget/src/                     # Embeddable chat widget (separate Vite build)
  embed.tsx                     # Auto-mount entry (Shadow DOM)
  react.tsx                     # React component export
  auto-detect.ts                # Script URL detection
  styles.css                    # Scoped CSS (no Tailwind)
  components/strapi-chat.tsx    # Chat UI component

tests/                          # E2E integration tests
docs/                           # Architecture + guardrails + email guides
```

## Testing

The plugin uses end-to-end integration tests against a running Strapi instance:

```bash
npm run test:guardrails    # Guardrail safety tests (42 assertions)
npm run test:api           # /ask and /ask-stream endpoint tests
npm run test:stream        # Streaming visual test
npm run test:chat          # Admin chat protocol test (/api/ai-sdk/chat)
npm run test:public-chat   # Public/widget chat (/api/ai-sdk/public-chat)
npm run test:unit          # Vitest unit tests (no Strapi needed)
npm run test:ts:back       # Server TypeScript type checking (no Strapi needed)
npm run test:ts:front      # Admin TypeScript type checking (no Strapi needed)
```

### Prerequisite: grant the Public role

The HTTP suites call content-API routes, so they return **403 until the Public role is
granted** the plugin's actions. This is easy to miss and silently makes the whole suite
unrunnable:

```
plugin::ai-sdk.controller.ask
plugin::ai-sdk.controller.askStream
plugin::ai-sdk.controller.chat
plugin::ai-sdk.controller.publicChat
plugin::ai-sdk.controller.serveWidget
```

Grant them in **Settings → Users & Permissions → Roles → Public**, or from your app's
`bootstrap()`.

### Why `test:public-chat` exists

`test:chat` covers the admin endpoint only. `/public-chat` — the surface the embeddable
widget uses — had no coverage, which let a real bug ship: `publicChat.chatModel` was
hardcoded to an Anthropic model id regardless of the configured provider, so pointing the
plugin at Ollama broke the widget with `model '...' not found` while admin chat kept
working. The suite asserts model resolution explicitly, and was verified to fail when that
bug is reintroduced.

With authentication:

```bash
STRAPI_TOKEN=your-api-token npm run test:guardrails
```

**MCP E2E suite** (separate from the scripts above — vitest-based, lives in `tests/e2e/`):

```bash
npm run test:e2e           # Structural, free — tool exposure, permission scoping, .describe() preservation, etc.
E2E_LIVE=1 npm run test:e2e:live   # Live pipeline — real YouTube/OpenAI/Neon calls
```

Both require a Strapi host >= 5.47 with `mcp: { enabled: true }`, all three
plugins linked, and `STRAPI_URL` / `STRAPI_ADMIN_TOKEN` (an admin token
granting the `plugin::ai-sdk.mcp.*` permissions) set.

**Status:** `test:e2e` (structural) has been run green — 12/12, including tool exposure,
permission scoping and `.describe()` preservation. `test:e2e:live` remains **unverified**:
it depends on YouTube transcript ingestion. That path was broken by a 400 from
`youtubei/v1/player` on `youtubei.js` 16.x and was fixed by upgrading to 17.x;
transcripts now fetch with or without a proxy. See
[`docs/plugin-contract.md`](./docs/plugin-contract.md#9-e2e-suites--unverified-prerequisites)
for the full prerequisite list before relying on them.

## Documentation

- [Plugin Contract](./docs/plugin-contract.md) -- the `ai-tools` service contract, `ToolDefinition`, namespacing, Zod rules, and per-tool permissions (source of truth)
- [Architecture](./docs/architecture.md) -- full system architecture, data flows, extension guides
- [Plugin Tool Discovery](./docs/plugin-tool-discovery.md) -- cross-plugin tool discovery architecture and implementation
- [Tool Standardization Spec](./docs/tool-standardization-spec.md) -- canonical tool format, Zod-first vs MCP-native comparison, portability
- [Guardrails](./docs/guardrails.md) -- guardrail system, pattern lists, `beforeProcess` hook API
- [Sending Emails with Resend](./docs/sending-emails-with-resend.md) -- Resend setup, email tool, domain verification

## License

MIT
