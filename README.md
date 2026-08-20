# Strapi Plugin AI SDK

An AI chat assistant inside the Strapi v5 admin panel, plus an MCP tool server that exposes the same tools to external AI clients.

---

## Highlights

- **Bring your own model.** Anthropic, or open-source models you run yourself. Nothing assumes a vendor.
- **Runs fully local.** Qwen, Gemma, Llama and friends via Ollama, vLLM or llama-swap. Your content never leaves the machine.
- **Per-tool permissions.** Grant `searchContent` without granting `sendEmail`, per role and per token.
- **MCP built in.** Registers its tools onto Strapi's official `/mcp` endpoint for Claude Desktop and other clients.
- **Extensible.** Other plugins contribute tools through a small service contract.
- **Guardrails.** Prompt-injection screening on chat input.

---

## Overview

Strapi holds unpublished drafts, customer records and internal documents. This plugin gives a model tools that read and write them, which makes the choice of where inference happens a real decision rather than a detail. You can keep all of it inside your own network.

There are exactly two surfaces:

| Surface | Where | Authenticates with | Tools it can use |
|---|---|---|---|
| Admin chat | `/ai-sdk/*` in the admin panel | Logged-in admin session | What that admin's **role** grants |
| MCP | Strapi's own `POST /mcp` | Admin API token | What that **token** grants |

The plugin does not serve `/mcp` itself. It registers its tools onto Strapi's built-in MCP server at boot.

Built on the [Vercel AI SDK](https://ai-sdk.dev/).

---

## Installation

**npm**

```bash
npm install strapi-plugin-ai-sdk
```

Requires Strapi 5.47 or later, which is where the built-in MCP server appears.

### 1. Configure the plugin

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

### 2. Enable Strapi's MCP server

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

> This goes in `config/server.ts`, not `config/plugins.ts`. Without it the plugin registers no tool permissions at all, which leaves admin chat with no tools either, not just MCP.

### 3. Build and start

```bash
npx strapi build
npx strapi develop
```

### 4. Grant the tools

Open **Settings > Administration Panel > Roles**, pick a role, and tick the tools under each plugin's section. Super Admin is granted everything automatically; every other role starts with nothing.

Chat is now available at **AI Chat** in the admin sidebar.

---

## Bring your own model

Two providers cover four deployment shapes. The tools, permissions and MCP surface are identical in every case.

| Deployment | Provider | Whose hardware | Content leaves your network |
|---|---|---|---|
| Frontier API | `anthropic` | Anthropic's | yes |
| Hosted inference | `openai-compatible` | a vendor's | yes |
| Self-hosted on cloud | `openai-compatible` | your rented GPU | not to a model vendor |
| Local or LAN | `openai-compatible` | your machine | **no** |

### Anthropic (default)

```typescript
config: {
  apiKey: env('ANTHROPIC_API_KEY'),
  chatModel: 'claude-sonnet-5',
}
```

Do not set `temperature` here. Anthropic's newer models reject it outright, which fails every request.

### Local models

Anything speaking the OpenAI wire format. `baseURL` is required, `apiKey` is not.

```typescript
config: {
  provider: 'openai-compatible',
  baseURL: env('AI_BASE_URL', 'http://localhost:11434/v1'),
  chatModel: env('AI_CHAT_MODEL', 'gemma4:26b'),
}
```

The model, your content and every tool result stay on the machine.

### Self-hosted on cloud hardware

Identical configuration, different host:

```typescript
config: {
  provider: 'openai-compatible',
  baseURL: env('AI_BASE_URL', 'https://inference.example.internal/v1'),
  apiKey: env('AI_API_KEY'),
  chatModel: 'qwen3.6-35b',
  temperature: 1,
  topP: 0.95,
}
```

The weights are yours and no model vendor is involved. The chat header will not show the LOCAL badge, since that tracks network location rather than ownership.

### Hosted inference vendors

Any vendor exposing an OpenAI-compatible chat completions endpoint uses the same
provider. Take the base URL and model id from that vendor's own documentation:

```typescript
config: {
  provider: 'openai-compatible',
  baseURL: env('AI_BASE_URL'),   // from your vendor
  apiKey: env('AI_API_KEY'),
  chatModel: env('AI_CHAT_MODEL'),
}
```

Not tested against any specific vendor. What the plugin requires is the wire
format, so anything that speaks it should work, but treat that as untested
rather than promised.

### Choosing a model

Tool calling is the requirement, not general fluency. A model that cannot call
tools reliably will describe what it would do instead of doing it.

These are the models actually exercised against this plugin during development,
not a compatibility matrix:

| Model | Served by | Notes |
|---|---|---|
| `claude-sonnet-5` | Anthropic | Best tool use, the default |
| `qwen3.6-35b` | llama-swap on a LAN box | Reasoning model, two-step tool loop in about 23s |
| `gemma4-kb` | Ollama | Completes full tool loops |
| `llama3.2:3b` | Ollama | Fast, but unreliable past one or two tool steps |

Below roughly 7B, tool calling degrades sharply. Small models narrate the tool call instead of emitting one.

Two things that surprise people:

- **Reasoning models need output headroom.** `qwen3.6-35b` spent 193 completion tokens reasoning before answering a one-word question. At `maxOutputTokens: 30` it returned nothing at all, with no error.
- **Local inference is slower.** Expect several times the latency of a frontier API.

### Registering your own provider

Any [AI SDK provider](https://ai-sdk.dev/providers/ai-sdk-providers) works:

```typescript
import { AIProvider } from 'strapi-plugin-ai-sdk/server/lib/ai-provider';
import { createMistral } from '@ai-sdk/mistral';

AIProvider.registerProvider('mistral', ({ apiKey, baseURL }) => {
  const provider = createMistral({ apiKey, baseURL });
  return (modelId: string) => provider(modelId);
});
```

The two built-ins are registered through this same call, so nothing about them is privileged.

---

## Permissions

Every tool has its own admin action, named `plugin::<owning-plugin>.tool.<slug>`. Tools contributed by another plugin appear under that plugin's section, not this one's.

The same actions gate two different callers:

- Granted on a **role**, they decide what that admin's chat can use.
- Granted on an **admin token**, they decide what that token exposes over `/mcp`.

An ungranted tool is invisible rather than merely blocked. It never appears in `tools/list`, and the chat model is never offered it.
---

## Connecting an MCP client

Mint an admin token under **Settings > Administration Panel > Admin Tokens**, ticking the tools it should reach. Then point your client at `/mcp`:

```json
{
  "mcpServers": {
    "strapi": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:1337/mcp", "--header", "Authorization: Bearer YOUR_ADMIN_TOKEN"]
    }
  }
}
```

Admin tokens, not content API tokens. They are different things in Strapi and only the former reaches `/mcp`.

---

## Available tools

Eight tools reach MCP:

`listContentTypes`, `searchContent`, `findOneContent`, `aggregateContent`, `createContent`, `updateContent`, `uploadMedia`, `sendEmail`

Six more are chat-only and need no grant, since they act on the calling admin's own data: `saveMemory`, `recallMemories`, `recallPublicMemories`, `saveNote`, `recallNotes`, `manageTask`.

> See [docs/plugin-contract.md](./docs/plugin-contract.md) for the full contract, and [docs/architecture.md](./docs/architecture.md) for how tools are registered and permissioned.

---

## Extending with custom tools

Another plugin exposes an `ai-tools` service, and this plugin discovers it at boot:

```typescript
// your-plugin/server/src/services/ai-tools.ts
import { z } from 'zod';

export default () => ({
  getTools() {
    return [
      {
        name: 'analyzeContent',
        description: 'Analyze content quality and suggest improvements',
        schema: z.object({
          documentId: z.string().describe('Document to analyze'),
        }),
        execute: async (args, strapi) => {
          return { score: 85 };
        },
      },
    ];
  },
});
```

The tool's permission appears under your plugin's own section, and starts ungranted.

> Full contract, namespacing rules and Zod requirements: [docs/plugin-contract.md](./docs/plugin-contract.md)

---

## Configuration reference

| Option | Default | Notes |
|---|---|---|
| `apiKey` | | Provider API key. Not required for most local runtimes. |
| `provider` | `anthropic` | `anthropic`, `openai-compatible`, or one you registered. |
| `baseURL` | | Required for `openai-compatible`. |
| `chatModel` | `claude-sonnet-5` | Model id. |
| `systemPrompt` | | Supports a `{tools}` placeholder. |
| `maxOutputTokens` | `8192` | Lower it with care on reasoning models. |
| `maxConversationMessages` | `15` | History kept per request. |
| `maxSteps` | `10` | Tool-call rounds per response. |
| `temperature`, `topP`, `topK` | | Omitted unless set. Anthropic rejects `temperature`; `openai-compatible` drops `topK`. |
| `guardrails` | enabled | See [docs/guardrails.md](./docs/guardrails.md). |

---

## Development

Changes to admin code need two builds, not one:

```bash
npm run build          # in the plugin
npx strapi build       # in the host app, easy to miss
npx strapi start
```

Strapi compiles plugin admin code into the host's own admin bundle. Rebuilding only the plugin updates the backend while the browser keeps serving the previously built admin, so admin changes appear to do nothing. Server-side changes need only the plugin build and a restart.

```bash
npm run test:unit      # no Strapi needed
npm run test:ts:back
npm run test:ts:front
```

---

## Documentation

- [Architecture](./docs/architecture.md): system design, data flows, permission model
- [Plugin contract](./docs/plugin-contract.md): the `ai-tools` service, tool definitions, namespacing
- [Guardrails](./docs/guardrails.md): screening, patterns, and what is not covered

---

## License

[MIT](./LICENSE)
