# AI Chat for Strapi

AI chat inside the Strapi v5 admin, with a tool system your own plugins extend,
and an MCP server that hands the same tools to external clients.

The chat is the surface people see. Underneath it is a tool registry: this
plugin ships content tools out of the box, any other plugin can contribute its
own through a small service contract, and everything registered is exposed to
external AI clients through Strapi's built-in MCP server. One definition, three
consumers.

Bring your own model. Anthropic, or anything OpenAI-compatible you run yourself.

---

## Highlights

- **Bring your own model.** Anthropic, or open-source models you run yourself. Nothing assumes a vendor.
- **Runs fully local.** Qwen, Gemma, Llama and friends via Ollama, vLLM or llama-swap. Your content never leaves the machine. Read [Choosing a model](#choosing-a-model) first, since model size decides whether tool calling actually works.
- **Per-tool permissions.** Grant `searchContent` without granting `sendEmail`, per role and per token.
- **MCP built in.** Registers its tools onto Strapi's official `/mcp` endpoint for Claude Desktop and other clients.
- **Extensible.** Other plugins contribute tools through a small service contract.
- **Guardrails.** Prompt-injection screening on chat input.
- **Shows you the budget.** A context badge reports how much of the model's window the conversation is using, which is the failure that otherwise looks like broken tool calling.
- **Shows the thinking.** Reasoning models stream their reasoning into a collapsible panel instead of pausing silently.

---

## Overview

Strapi holds unpublished drafts, customer records and internal documents. This plugin gives a model tools that read and write them, which makes the choice of where inference happens a real decision rather than a detail. You can keep all of it inside your own network.

There are exactly two surfaces:

| Surface | Where | Authenticates with | Tools it can use |
|---|---|---|---|
| Admin chat | `/ai-chat/*` in the admin panel | Logged-in admin session | What that admin's **role** grants |
| MCP | Strapi's own `POST /mcp` | Admin API token | What that **token** grants |

The plugin does not serve `/mcp` itself. It registers its tools onto Strapi's built-in MCP server at boot.

Built on the [Vercel AI SDK](https://ai-sdk.dev/).

---

## Installation

**npm**

```bash
npm install strapi-plugin-ai-chat
```

Requires Strapi 5.47 or later, which is where the built-in MCP server appears.

### 1. Configure the plugin

```typescript
// config/plugins.ts
export default ({ env }) => ({
  'ai-chat': {
    enabled: true,
    config: {
      apiKey: env('ANTHROPIC_API_KEY'),
      chatModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5'),
    },
  },
});
```

> The config key is `'ai-chat'`, not the package name. The plugin's id is pinned
> separately from what it is called on npm, because that id names its database
> tables, its admin routes, and every per-tool permission. Renaming the package
> deliberately left it alone.

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

Read this before you pick one. It is the difference between the plugin working
and the plugin looking broken.

**Size matters more than you expect.** This plugin does not just ask a model
questions. It hands the model tools and asks it to use them, often several in a
row: read a transcript, look up the schema, then write a record. Small models
can hold a conversation just fine and still fail completely at that. When they
fail, they usually do not say so. They write "I have saved the article" and stop,
having saved nothing.

Rough guidance from testing this plugin:

| Size | What to expect |
|---|---|
| Under 7B | Will not reliably call tools at all |
| 8B or so | Calls one tool, then tends to narrate the rest instead of doing it |
| 14B | The first tier that completed a multi step write here, with `qwen3:14b` |
| 26B to 35B | Varies by model family more than by size |
| Frontier (Claude, and similar) | Handles the full chain and recovers from its own mistakes |

**Watch the context window, not just the model.** This is the trap that costs
people the most time. A chat request from this plugin carries roughly 7,000
tokens of instructions and tool definitions before your question is even read.
Ollama defaults to a 4,096 token window unless the model file sets `num_ctx`,
so a large capable model can be silently truncated to less than it needs and
appear to hang or ignore its tools. Check it:

```bash
ollama show <model> | grep num_ctx     # blank means the 4,096 default applies
```

Fix it by creating a variant with a real window. This reuses the existing
layers, so it does not duplicate the weights:

```bash
printf 'FROM <model>\nPARAMETER num_ctx 32768\n' > Modelfile
ollama create <model>-32k -f Modelfile
```

Note that `maxOutputTokens` does not help here. That limits what the model
writes, not how much it can read.

**Recovery is the real skill.** Writing content usually fails on the first try,
because the model guesses a field value that your schema rejects. What separates
a model that works from one that does not is whether it reads the error and
tries again. In one measured run Claude hit two separate errors, corrected both,
and created the article on its fourth attempt. Smaller models spend their single
attempt and give up.

These are the models actually exercised against this plugin, not a compatibility
matrix:

| Model | Served by | Result on a transcript to article task |
|---|---|---|
| `claude-sonnet-5` | Anthropic | Completes it, recovers from failed writes. The default |
| `qwen3:14b` | Ollama | Completes it, recovers from a failed write. Best local result |
| `qwen3.6-35b` | llama-swap on a LAN box | Short tool chains work, needs generous output headroom |
| `gemma4:26b` | Ollama | Reads and searches, did not complete the write |
| `gemma4-kb` (8B) | Ollama | Fetches, then describes the save instead of doing it |
| `llama3.2:3b` | Ollama | Does not call the tools |

If you want everything on your own hardware, that works. `qwen3:14b` with a
32k window completed the same transcript to article task as the frontier model,
including correcting a rejected write on its second attempt. Note that model
family matters more than parameter count: a 26B model failed the task that this
14B one passed.

Two more things that surprise people:

- **Reasoning models need output headroom.** `qwen3.6-35b` spent 193 completion tokens reasoning before answering a one word question. At `maxOutputTokens: 30` it returned nothing at all, with no error.
- **Local inference is slower.** Expect several times the latency of a frontier API. A 26B model can take minutes on a single step.

### Registering your own provider

Any [AI SDK provider](https://ai-sdk.dev/providers/ai-sdk-providers) works.
Register it from your app through the plugin's `provider` service:

```typescript
// src/index.ts
import { createMistral } from '@ai-sdk/mistral';

export default {
  register({ strapi }) {
    strapi.plugin('ai-chat').service('provider').register(
      'mistral',
      ({ apiKey, baseURL }) => {
        const provider = createMistral({ apiKey, baseURL });
        return (modelId: string) => provider(modelId);
      },
    );
  },
};
```

Then set `provider: 'mistral'` in the plugin config.

The two built-ins are registered through this same call, so nothing about them is privileged. Registration works from `register()` or `bootstrap()` in any order relative to the plugin's own lifecycle, because the provider is resolved lazily on first model use rather than at boot.

---

## Permissions

Every tool has its own admin action, named `plugin::<owning-plugin>.tool.<slug>`. Tools contributed by another plugin appear under that plugin's section, not this one's.

The same actions gate two different callers:

- Granted on a **role**, they decide what that admin's chat can use.
- Granted on an **admin token**, they decide what that token exposes over `/mcp`.

An ungranted tool is invisible rather than merely blocked. It never appears in `tools/list`, and the chat model is never offered it.

> Upgrading from a version before 1.2.0? The old `plugin::ai-chat.mcp.read/.write/.destructive/.maintenance` actions no longer exist, and Strapi prunes grants whose action id is gone. Tools must be re-granted individually, or every client sees an empty tool list with no error.

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
| `anthropicApiKey` | | **Deprecated.** Fallback for existing installs; warns once at boot. Use `apiKey`. |
| `provider` | `anthropic` | `anthropic`, `openai-compatible`, or one you registered. |
| `baseURL` | | Required for `openai-compatible`. An empty string is treated as unset. |
| `chatModel` | `claude-sonnet-5` | Model id. |
| `systemPrompt` | | Replaces the default preamble. Supports a `{tools}` placeholder. Tool-use rules are appended regardless, so setting this cannot drop them. |
| `maxOutputTokens` | `8192` | Lower it with care on reasoning models. |
| `maxConversationMessages` | `15` | History kept per request. |
| `maxSteps` | `10` | Tool-call rounds per response. |
| `toolTimeoutMs` | `60000` | Abandon a single tool call after this long, so a hung tool fails legibly instead of freezing the turn. `0` waits forever. |
| `contextWindow` | | Tokens the model can actually read. Only needed when detection cannot work it out — see the context badge in the chat toolbar. |
| `temperature`, `topP`, `topK` | | Omitted unless set. Anthropic rejects `temperature`; `openai-compatible` drops `topK`. |
| `guardrails` | enabled | See [docs/guardrails.md](./docs/guardrails.md). |

`frequencyPenalty`, `presencePenalty`, `seed` and `providerOptions` are also forwarded when set, and omitted entirely otherwise.

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

- [Architecture](./docs/architecture.md): lifecycle, tool pipeline, permission model, storage, context budget
- [Plugin contract](./docs/plugin-contract.md): the `ai-tools` service, tool definitions, Zod rules, namespacing
- [Guardrails](./docs/guardrails.md): screening, patterns, and what is not covered
- [Sending email](./docs/sending-emails-with-resend.md): the `sendEmail` tool and provider setup


---

## License

[MIT](./LICENSE)
