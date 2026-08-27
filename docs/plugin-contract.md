# Plugin contract

How another Strapi plugin contributes tools to `strapi-plugin-ai-chat`, and what
it can rely on. Current as of **2.6.0**.

This is the single reference for extension plugins. It replaces
`tool-standardization-spec.md`, `plugin-tool-discovery.md` and
`mcp-consolidation.md`, which were pre-implementation proposals for work that
has since shipped; they are kept unchanged under [`docs/old/`](./old/) for their
historical rationale.

Audience: anyone writing an extension plugin, and anyone debugging why a tool
did not show up in chat or in `tools/list`.

## Contents

- [Requirements](#requirements)
- [Why extensions rather than separate MCP servers](#why-extensions-rather-than-separate-mcp-servers)
- [The `ai-tools` service](#the-ai-tools-service)
- [The `ToolDefinition` interface](#the-tooldefinition-interface)
- [Zod rules](#zod-rules)
- [Namespacing](#namespacing)
- [Permissions](#permissions)
- [Failure isolation](#failure-isolation)
- [Version compatibility](#version-compatibility)
- [Building an extension plugin](#building-an-extension-plugin)
- [Naming conventions](#naming-conventions)
- [Troubleshooting](#troubleshooting)

---

## Requirements

- **Strapi >= 5.47.0.** The official MCP server (`strapi.ai.mcp`) does not exist
  below it — `strapi.ai` is simply absent.
- **The host app must opt in to MCP.** No plugin can turn this on from inside a
  plugin:

  ```typescript
  // config/server.ts
  export default ({ env }) => ({
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    mcp: { enabled: true },
  });
  ```

  Without it the plugin registers no tool permissions at all, which leaves
  **admin chat** with no tools either — not just MCP. This surprises people, so
  it is worth stating twice.

- **Zod 4** (`zod@^4.3.5`), matching what this plugin ships.

---

## Why extensions rather than separate MCP servers

A plugin wanting to expose tools to an AI client has two options: ship its own
MCP server, or contribute tools to this one. This project standardised on the
second, and the reasoning is worth knowing because it explains the shape of
everything below.

A standalone server means the user configures another endpoint, mints another
token, and runs another transport. Their client then holds N connections to one
Strapi instance, each with its own auth and its own tool namespace, and the
model has no way to use a transcript tool and a content tool in the same step
without the client federating them.

Contributing tools means one endpoint, one token, one permission grid, and one
registry the model sees as a single toolbox. The cost is a service contract to
conform to — the rest of this document.

The tradeoff flips if your tools have nothing to do with Strapi's content. A
tool that never touches `strapi.documents()` gains little from living here.

---

## The `ai-tools` service

At boot, `strapi-plugin-ai-chat` iterates every other installed plugin and looks
for a service named exactly `ai-tools`:

```typescript
strapi.plugin(pluginName)?.service?.('ai-tools')
```

### `getTools()` — required

Returns an array of `ToolDefinition`. Called once, at boot.

```typescript
// server/src/services/ai-tools.ts
import { tools } from '../tools';

export default () => ({
  getTools() {
    return tools;
  },
});
```

It must be synchronous and must not throw. Returning something that is not an
array is ignored silently.

### `getMeta()` — optional

Describes the tool source for humans and for the tool-guide MCP resource:

```typescript
getMeta() {
  return {
    label: 'YouTube Transcripts',
    description: 'Fetch, search, list, and read YouTube video transcripts',
    keywords: ['/youtube', '/yt', 'transcript', 'video'],
  };
}
```

Only stored when **both** `label` and `description` are present, and only when
at least one tool registered successfully. `keywords` are trigger hints a user
might type.

This is not injected into the system prompt. The official MCP server does not
let plugins set server-level `instructions`, so source metadata surfaces in the
tool guide resource at `strapi://ai-chat/tools/guide` instead.

---

## The `ToolDefinition` interface

```typescript
interface ToolDefinition {
  name: string;          // camelCase, [a-zA-Z0-9_-] only
  description: string;   // what the model reads to decide whether to call it
  schema: z.ZodObject<any>;
  execute: (args, strapi, context?) => Promise<unknown>;
  internal?: boolean;    // chat only, never exposed over MCP
  publicSafe?: boolean;  // risk metadata only — grants nothing
  access?: 'read' | 'write' | 'destructive' | 'maintenance';
}
```

`name`, `description`, `schema` and `execute` are all required; a definition
missing any of the first three is skipped with a warning. (`execute` is checked
too — a definition without it never registers.)

> **You cannot import this type.** `strapi-plugin-ai-chat/strapi-server` resolves
> to a bundle whose only export is the Strapi plugin object itself
> (`module.exports = index`). `ToolDefinition`, its alias
> `AiToolContribution`, and the `jsonCoercible` helper all exist in this
> plugin's source but are not reachable from the package entry.
>
> Discovery is duck-typed, so this costs you nothing at runtime. Declare the
> interface in your own plugin and let structural typing line it up — which is
> what the existing extension plugins do. Keep the copy in one file so there is
> a single place to update when this contract changes.

**`description` is the most important field you write.** It is what the model
reads when deciding between your tool and `searchContent`. Say what it does,
when to prefer it, and what it costs. Descriptions are concatenated into the
system prompt for every request, so keep them dense rather than long.

### `access` and `publicSafe`

`publicSafe` no longer grants anything. It used to decide what anonymous chat
could reach, which failed open — an author forgetting the flag was the only
thing between a visitor and a write tool.

Both fields are now risk metadata, feeding `tierFor()`:

```
access ?? (publicSafe ? 'read' : 'write')
```

That tier does two things: it labels the tool in the permissions grid to help a
human decide what to tick, and it decides whether the tool is **withdrawn after
a successful call** (see [architecture.md](./architecture.md#withdrawing-a-tool-after-a-write)).
Anything not tiered `read` is withdrawn once it returns a result, so the model
cannot repeat a write it has already completed.

Mark genuinely read-only tools `publicSafe: true` — otherwise they default to
`write` and get withdrawn after one call, which will look like your tool
stopping halfway through a task.

Use `access: 'maintenance'` for a tool that is read-only but expensive: one that
spends money, calls a paid external API, or runs long enough that a token holder
could loop it. It is never derived, only set explicitly.

---

## Zod rules

Schemas are handed to the official MCP server untouched. It detects Zod 4 by
duck-typing and converts with its own bundled `zod/v4-mini`. No conversion layer
sits in between, and adding one would strip `.describe()` text.

**Describe every parameter.** The description is most of what tells a model how
to call the tool:

```typescript
schema: z.object({
  videoId: z.string().describe('YouTube video ID, 11 characters'),
  language: z.string().optional().describe('ISO 639-1 code, defaults to en'),
})
```

**Use `.optional()` rather than `.default()`** where the model should be able to
omit a parameter. Defaults are applied after validation and do not always appear
in the emitted JSON Schema the way you expect.

**Make array and object parameters tolerant of JSON strings** if MCP clients
will call the tool. Clients — notably through `mcp-remote` — sometimes send
complex arguments as JSON text: `fields: '["title","slug"]'` instead of
`fields: ["title"]`. The official server validates arguments **before** your
handler runs, so a rescue inside `execute` is too late; it has to live in the
schema.

This plugin uses a helper called `jsonCoercible` for that. It is not exported
from the package, so copy it — it is six lines:

```typescript
export function jsonCoercible<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try { return JSON.parse(trimmed); } catch { return value; }
  }, schema) as z.ZodType<z.infer<T>>;
}
```

```typescript
schema: z.object({
  fields: jsonCoercible(z.array(z.string())).optional()
    .describe('Fields to return'),
})
```

`z.preprocess` rather than a union is deliberate: it coerces at parse time while
still emitting the wrapped schema's own JSON Schema, so clients keep seeing a
typed parameter — a union would emit `anyOf` and would not coerce. It only
touches strings starting with `{` or `[`, leaving genuine string values like
`populate: "*"` alone, and a malformed JSON string falls through to the wrapped
schema's own validation error.

**Do not set `additionalProperties` or tool annotations.** The official server
owns schema emission; anything you set there is discarded.

**The top level must be a `ZodObject`.** Not a union, not an array.

### Honour the abort signal

`execute` receives a `context` carrying an `abortSignal`. It fires when the user
stops the turn, or when your tool exceeds `toolTimeoutMs` (default 60s).

```typescript
async execute(args, strapi, context) {
  const res = await fetch(url, { signal: context?.abortSignal });
  return res.json();
}
```

Honouring it is optional but strongly worth doing for anything making a network
call. A tool that ignores it still gets abandoned on timeout — the turn is freed
regardless — but the underlying request keeps running to completion in the
background, into nothing.

Anything without its own timeout is what makes a chat freeze rather than fail:
a spinner on a tool that never settles, and no error to explain it.

---

## Namespacing

A contributed tool is registered under its source plugin's name:

```
<safePluginName>__<toolName>
```

where `safePluginName` is the Strapi plugin id with every character outside
`[a-zA-Z0-9_-]` replaced by `_`. So `fetchTranscript` from a plugin whose id is
`ai-sdk-yt-transcripts` becomes `ai-sdk-yt-transcripts__fetchTranscript`.

Double underscore is the separator because tool names are restricted to that
character class, so it cannot collide with a camelCase name.

Built-in tools carry no prefix.

That one registry name is then transformed three ways, and the differences are
deliberate:

| Context | Form | Example |
|---|---|---|
| Registry | camelCase, `__`-prefixed | `ai-sdk-yt-transcripts__fetchTranscript` |
| MCP tool name | snake_case | `ai_chat_yt_transcripts__fetch_transcript` |
| Admin action | hyphens, prefix stripped | `plugin::ai-sdk-yt-transcripts.tool.fetch-transcript` |

MCP names are snake_case to match Strapi's own built-in tools. Action slugs use
hyphens because Strapi's admin action uid validator accepts only lowercase
letters, dots and hyphens — no underscores. The source prefix is stripped from
the action because the plugin section already identifies the source; repeating
it would give you
`plugin::ai-chat.tool.ai-sdk-yt-transcripts__fetch-transcript`.

**Name collisions are skipped, not overwritten.** Two plugins can both expose a
`search` tool without clashing, since the prefix disambiguates them. A duplicate
*within* one plugin logs a warning and the second is dropped.

---

## Permissions

Every non-`internal` tool gets its own admin action, registered under **the
contributing plugin's own section** of the permissions grid, grouped in the
subcategory **AI tools**:

```
plugin::<your-plugin-id>.tool.<action-slug>
```

The same action gates two callers: granted on a **role** it decides what that
admin's chat can use; granted on an **admin token** it decides what that token
exposes over `/mcp`.

**Every tool starts ungranted.** Super Admin is granted everything
automatically; every other role begins with nothing. An ungranted tool is
invisible rather than blocked — absent from `tools/list`, never offered to the
chat model.

`internal: true` tools get no action at all and are exempt from the check,
because an action that was never registered cannot be granted to anyone,
including Super Admin. Use `internal` only for bookkeeping scoped to the calling
admin's own data.

---

## Failure isolation

Two layers, so one broken plugin cannot take down the others or the host.

**At discovery.** Each plugin's `getTools()` call is individually wrapped. A
throw is caught and logged as `Tool discovery failed for <plugin>`, and the scan
continues to the next plugin. Malformed definitions are skipped individually.

**At MCP registration.** Each `registerTool()` call is individually wrapped. The
capability registry throws synchronously on conflicts — a duplicate name across
plugins, a missing auth policy — and one bad tool must not take down the
registration pass or Strapi's boot. Failures skip and continue with a warning
naming the tool.

Beyond both, the whole MCP branch of `bootstrap()` sits in an outer try/catch,
so even a host shape change in `strapi.ai` degrades to "MCP tools unavailable"
rather than a failed boot.

At runtime, a tool that throws is caught in `createTools()` and rethrown through
`describeToolFailure()`, which flattens Strapi's `details.errors` into the
message so the model can read which field failed and why. Throw real errors with
useful messages — they are shown to the model, and a good one is the difference
between a corrected retry and a fabricated success.

---

## Version compatibility

Declare a peer dependency:

```json
"peerDependencies": {
  "strapi-plugin-ai-chat": "^2.0.0"
}
```

At discovery, `checkPluginCompat()` compares that range against the running
version and warns on a mismatch:

```
[ai-sdk] Plugin "ai-sdk-yt-transcripts" requires strapi-plugin-ai-chat ^1.1.0
but 2.6.0 is installed. Its tools may not register correctly — upgrade one of
the two packages.
```

It is a diagnostic, not a gate — tools register either way. The check handles
`^1.1.0`, `>=0.7.0` and exact `1.1.0`; anything it cannot parse passes.

---

## Building an extension plugin

### Structure

```
your-plugin/
  server/src/
    services/
      ai-tools.ts       getTools() + optional getMeta()
      index.ts          export it under the key 'ai-tools'
    tools/
      index.ts          barrel export
      fetch-thing.ts    one file per tool
  package.json
```

You do **not** need an MCP server, a transport, routes, controllers, or
permission registration. All of that is handled for you.

You **do** need the service registered under exactly the key `ai-tools`:

```typescript
// server/src/services/index.ts
import aiTools from './ai-tools';

export default { 'ai-tools': aiTools };
```

### A tool

```typescript
// server/src/tools/fetch-thing.ts
import { z } from 'zod';
import type { ToolDefinition } from './types'; // your own local copy

export const fetchThingTool: ToolDefinition = {
  name: 'fetchThing',
  description:
    'Fetch a thing by id. Prefer this over searchContent when the caller ' +
    'already knows the id — it is a single lookup rather than a query.',
  schema: z.object({
    id: z.string().describe('The thing id'),
  }),
  publicSafe: true,
  async execute(args, strapi) {
    return strapi.documents('plugin::your-plugin.thing').findOne({
      documentId: args.id,
    });
  },
};
```

### Checklist

- [ ] Service registered under the key `ai-tools`
- [ ] `getTools()` synchronous, returns an array, never throws
- [ ] Every tool has `name`, `description`, `schema`, `execute`
- [ ] `ToolDefinition` declared locally — it is not importable from the package
- [ ] Every schema parameter has `.describe()`
- [ ] Array/object parameters wrapped in a `jsonCoercible()` copy
- [ ] Read-only tools marked `publicSafe: true` so they are not withdrawn after one call
- [ ] Expensive tools marked `access: 'maintenance'`
- [ ] `peerDependencies` declares a `strapi-plugin-ai-chat` range
- [ ] `zod@^4`
- [ ] Tools tested directly, without booting Strapi

---

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Package name | name it for what it does | `strapi-plugin-youtube-transcripts` |
| Strapi plugin id | stable, and pinned | `ai-sdk-yt-transcripts` |
| Tool name | camelCase verb-noun | `fetchTranscript` |

**Do not name your package after this plugin.** A contributing plugin does not
depend on this one, so a name like `strapi-plugin-ai-sdk-<domain>` advertises a
coupling that does not exist and tells anyone browsing npm that they must adopt
an AI stack to use it. Name it for the capability; the AI tools are additive.

**Pin your plugin id and then leave it alone.** Set `strapi.name` in
`package.json` so the id is fixed independently of what npm calls the package.
The id becomes the namespace prefix on every tool name, the permission section
in Settings > Roles, the prefix on your database tables and your admin routes.
Changing it later orphans every existing grant and every stored row, silently.
Renaming the package is cheap precisely because the two are separate.

---

## Troubleshooting

**The tool does not appear anywhere.** Check the boot log for
`Found ai-tools service on plugin: <name>` followed by
`Registered N tools from plugin: <name>`. Neither line means the service was not
found — usually a wrong service key, or the plugin is not enabled.

**Tools registered but `tools/list` is empty.** The token holds none of the
actions. Look for the warning that says permissions were registered but nothing
grants them. Grant the tools under your plugin's section in **Settings > Admin
Tokens**. This is the normal state after an upgrade, because Strapi prunes
permission rows whose action id no longer exists.

**The tool appears over MCP but not in chat.** The same actions gate chat, but
per role rather than per token. Grant them in **Settings > Roles**.

**The tool works once and then the model stops using it.** It is being withdrawn
after a successful call because it is not tiered `read`. Add `publicSafe: true`
or `access: 'read'`.

**Arguments arrive as strings.** Wrap those parameters in your `jsonCoercible()`
copy.

**Everything registers but the model never chooses the tool.** That is a
description problem, not a wiring problem. Say when to prefer it over
`searchContent` explicitly — the default preamble already tells the model to
prefer specialised tools, but only if it can tell yours is one.
