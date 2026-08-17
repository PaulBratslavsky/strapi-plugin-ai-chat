# Plugin Contract

**Status:** Source of truth as of `v1.1.0`.
**Audience:** anyone writing or maintaining an extension plugin for
`strapi-plugin-ai-sdk` (e.g. `strapi-plugin-ai-sdk-yt-transcripts`,
`strapi-plugin-ai-sdk-yt-embeddings`), and anyone debugging why a tool
did not show up in the admin chat, the public widget, or MCP.

This document supersedes the tool-contract portions of
[`mcp-consolidation.md`](./mcp-consolidation.md) and
[`tool-standardization-spec.md`](./tool-standardization-spec.md). Those are
kept for their historical rationale (why the hub/extension split was chosen
over standalone MCP servers) but are no longer the place to look for the
current contract, namespacing rules, Zod rules, or MCP permission tiers.

---

## 1. Requirements

- **Strapi >= 5.47.0** — the official MCP server (`strapi.ai.mcp`) does not
  exist below this version. `strapi.ai` is simply absent.
- The **host application** must set `mcp: { enabled: true }` in its own
  `config/server.ts`. No plugin — ai-sdk included — can turn this on from
  inside a plugin; it is a host-level opt-in.

```ts
// <strapi-app>/config/server.ts
export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  mcp: {
    enabled: true,
  },
  // ...
});
```

If either condition is unmet, `registerAiSdkMcpTools()`
(`server/src/mcp/index.ts`) logs
`[ai-sdk:mcp] Official MCP server not enabled — skipping tool registration.`
and returns. The admin chat and public widget are unaffected — only MCP
exposure is skipped.

---

## 2. The `ai-tools` service contract

An extension plugin contributes tools to ai-sdk by exposing a Strapi service
named exactly `ai-tools`. `ai-sdk`'s `bootstrap()` scans every other
registered plugin (`discoverPluginTools()` in `server/src/bootstrap.ts`) and,
for each one, looks up `strapi.plugin(pluginName).service('ai-tools')`.

```ts
// server/src/services/ai-tools.ts
import { tools } from '../tools';

export default () => ({
  getTools() {
    return tools; // ToolDefinition[]
  },

  // Optional
  getMeta() {
    return {
      label: 'YouTube Transcripts',
      description: 'Fetch, search, list, and read YouTube video transcripts',
      keywords: ['/youtube', '/yt', 'transcript', 'video'],
    };
  },
});
```

### `getTools()` — required

Returns an array of `ToolDefinition` objects (see §3). Anything in the array
missing `name`, `execute`, or `schema` is skipped with a warning; it does not
abort discovery for the rest of the plugin's tools.

### `getMeta()` — optional

Returns `{ label, description, keywords? }`. This is **not** consumed as MCP
server `instructions` (the official server has no such hook — see §7). It is
collected during discovery and only feeds the `strapi://ai-sdk/tools/guide`
MCP resource (`server/src/mcp/resources/tool-guide.ts`), where it becomes the
section heading and blurb for that plugin's tools. A client only sees it after
reading the resource, which typically happens after the server is already
active — read §7 before assuming this replaces routing hints.

`getMeta()` is only recorded if the plugin registered at least one tool
successfully **and** both `label` and `description` are present.

### Failure isolation is two-layered

The skip-and-warn behavior above (discovery time, in `bootstrap.ts`) has a
counterpart at MCP-registration time, in `server/src/mcp/`:

- **Per-tool** (`register-tools.ts`): each tool's `mcp.registerTool()` call
  is individually wrapped in try/catch — one tool failing (e.g. a name
  collision with a Strapi-derived built-in) is skipped with a warning; the
  rest still register.
- **Whole-pass** (`mcp/index.ts`): `registerAiSdkMcpTools()` wraps admin
  permission registration, tool registration, and resource registration in
  one outer try/catch. An unexpected throw anywhere in that block is caught,
  logged at `strapi.log.error`, and **not rethrown** — Strapi still finishes
  booting; only MCP capability registration is affected. This outer catch is
  not transactional: tools already registered via `mcp.registerTool()`
  before a later failure stay registered.

Full detail, including why the outer catch isn't transactional:
[`architecture.md`](./architecture.md#mcp-server).

---

## 3. The `ToolDefinition` interface

```ts
// server/src/lib/tool-registry.ts
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  execute: (args: any, strapi: Core.Strapi, context?: ToolContext) => Promise<unknown>;

  /** If true, tool is only available in AI SDK chat, not exposed via MCP. */
  internal?: boolean;

  /** If true, tool is safe for unauthenticated public chat (read-only). */
  publicSafe?: boolean;

  /**
   * MCP permission tier. Defaults to 'read' when publicSafe is true,
   * otherwise 'write'. Set explicitly for tools whose risk does not match
   * that default — e.g. irreversible or external-side-effect tools.
   */
  access?: 'read' | 'write' | 'destructive';
}
```

- **`internal`** — tools with `internal: true` never reach MCP, regardless of
  `access` or `publicSafe`. `ToolRegistry.getPublic()` filters them out before
  `registerToolsOnMcp()` ever sees them. Use this for chat-only tools (the
  built-in memory/notes/task tools all set it).
- **`publicSafe`** — orthogonal to `internal`. It means "safe for the
  unauthenticated public chat widget," and it also feeds the `access` default
  (see §4). A tool can be `publicSafe: true` and still `internal: true` (e.g.
  `recallPublicMemories`) — public-chat-eligible but never exposed on MCP.
- **`access`** — new field, added for this migration. See §4 for how it
  resolves to an MCP permission action.

### Where the built-in tools land

Eight of the fourteen built-in tools are non-`internal` and therefore reach
MCP:

| Tool (registry name) | MCP name | `access` |
|---|---|---|
| `listContentTypes` | `list_content_types` | read (`publicSafe`) |
| `searchContent` | `search_content` | read (`publicSafe`) |
| `findOneContent` | `find_one_content` | read (`publicSafe`) |
| `aggregateContent` | `aggregate_content` | read (`publicSafe`) |
| `createContent` | `create_content` | write (default) |
| `updateContent` | `update_content` | write (default) |
| `uploadMedia` | `upload_media` | write (default) |
| `sendEmail` | `send_email` | destructive (explicit `access: 'destructive'`) |

`saveMemory`, `recallMemories`, `saveNote`, `recallNotes`, `manageTask`, and
`recallPublicMemories` are all `internal: true` and stay chat-only.

---

## 4. MCP permission tiers

The official MCP server gates every custom tool behind an admin permission
`action` string on `auth.policies`. A token only sees a tool in `tools/list`
if its role grants that action. ai-sdk registers three actions of its own
(`server/src/mcp/permissions.ts`), under `section: 'plugins'` /
`pluginName: 'ai-sdk'`, which Strapi's action-provider turns into
`plugin::ai-sdk.*` ids:

| Action id | Displayed as | Covers |
|---|---|---|
| `plugin::ai-sdk.mcp.read` | Use read-only AI SDK MCP tools | `listContentTypes`, `searchContent`, `findOneContent`, `aggregateContent`, and 8 of the 9 `yt-transcripts`/`yt-embeddings` tools (all but `fetchTranscript`) |
| `plugin::ai-sdk.mcp.write` | Use content-mutating AI SDK MCP tools | `createContent`, `updateContent`, `uploadMedia`, and `yt-transcripts`' `fetchTranscript` (it creates a transcript document, which fires yt-embeddings' `afterCreate` hook — an OpenAI embeddings call plus pgvector writes) |
| `plugin::ai-sdk.mcp.destructive` | Use irreversible / external-side-effect AI SDK MCP tools | `sendEmail` |

### Tier derivation (`server/src/mcp/access.ts`)

```ts
export function tierFor(def: Tierable): AccessTier {
  return def.access ?? (def.publicSafe ? 'read' : 'write');
}
```

An explicit `access` always wins. Otherwise `publicSafe` (already meaning
"read-only, safe for anonymous chat") implies `read`; everything else — the
safe default for third-party tools that set neither field — defaults to
`write`. `sendEmail` and `yt-transcripts`' `fetchTranscript` both need an
explicit tier: `sendEmail` because it's irreversible/external-side-effect,
and `fetchTranscript` because `publicSafe: true` would otherwise default it
to `read` even though it writes a document (see above).

Because permission gating filters `tools/list` itself (not just tool
execution), a token granted only `mcp.read` cannot see or invoke the write
and destructive tools. This still depends on every tool author setting
`access`/`publicSafe` correctly — `publicSafe` describes "safe to expose to
anonymous public chat," not "does not write," so a `publicSafe` tool that
mutates data (like `fetchTranscript`) must still declare `access: 'write'`
explicitly. `mcp.read` is a permission boundary enforced by the tier a tool
declares, not an automatic guarantee that every `read`-tiered tool is
side-effect-free — treat it as browse-only for the built-ins, which are
audited, and verify third-party/plugin tools individually before trusting
the same claim for them.

### Registering the actions

`registerMcpAdminPermissions()` runs on every boot, from
`registerAiSdkMcpTools()`, via
`strapi.service('admin::permission').actionProvider.registerMany(...)`. It is
idempotent — safe to run every boot — and must complete before tools are
registered, since each tool's `auth.policies` references one of these action
ids.

To grant an admin API token access, in **Settings → Administration Panel →
API Tokens**, create/edit a token, and under **Ai-sdk**, enable the actions
for the tiers that token should reach.

---

## 5. Namespacing

Two separate transformations run in sequence: registry namespacing (adds a
prefix), then MCP name conversion (snake_cases everything).

### Registry namespacing (`discoverPluginTools()` in `bootstrap.ts`)

```ts
const safeName = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
const namespacedName = `${safeName}__${tool.name}`;
```

`pluginName` is the Strapi plugin id (e.g. `ai-sdk-yt-transcripts`, not the
npm package name `strapi-plugin-ai-sdk-yt-transcripts`). The sanitizer's
character class **allows hyphens**, so a hyphenated plugin id keeps its
hyphens in the registry key: `ai-sdk-yt-transcripts__fetchTranscript`.

### MCP name conversion (`toSnakeCase()` in `mcp/naming.ts`)

```ts
export function toSnakeCase(str: string): string {
  return str
    .replace(/:/g, '__')
    .replace(/-/g, '_')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
```

This runs only when a tool is handed to `mcp.registerTool()` — it converts
**both** the hyphens from the namespace prefix **and** the camelCase of the
tool's own name:

```
ai-sdk-yt-transcripts__fetchTranscript
  → toSnakeCase →
ai_sdk_yt_transcripts__fetch_transcript
```

### The naming asymmetry (not a bug)

Registry keys keep hyphens; MCP tool names use underscores throughout. This
looks inconsistent at a glance but is intentional: the registry key is an
internal identifier (also used for admin-UI tool source grouping and log
lines), while the MCP tool name must satisfy the MCP protocol's naming
convention and match Strapi's own built-in tools (`list_article`,
`get_article`). Don't "fix" the registry key to use underscores — that would
just move the asymmetry, not remove it, since `toSnakeCase()` treats `-` and
camelCase identically either way.

---

## 6. Zod rules

**Always** `import { z } from 'zod'` in tool schemas — your own package's Zod
4 dependency. **Never** `import { z } from '@strapi/utils'`.

Both are Zod 4 (Strapi's `@strapi/utils` re-exports `zod/v4`), so this is not
a version-compatibility problem. It is an **instance-identity** problem: Zod
4 stores `.describe()` text in a per-instance global registry, and the MCP
SDK's schema-to-JSON-Schema converter reads that registry using *its own*
zod instance. A schema built with a *different* zod instance's builder
functions (e.g. `@strapi/utils`'s re-exported `z`) is invisible to the SDK's
registry lookup — every parameter description is silently dropped. The tool
still registers, still works, and still validates arguments correctly; it
just ships with an empty `description` field on every parameter in
`tools/list`, degrading the model's ability to call it correctly.

```ts
// Correct — plugin's own zod
import { z } from 'zod';

export const mySchema = z.object({
  city: z.string().describe('City name'), // description survives conversion
});

// Wrong — silently drops every .describe()
import { z } from '@strapi/utils';
```

This is also why `zod` must **not** be listed in `bundledDependencies` — a
bundled copy is a second instance, with the same identity problem.

### `jsonCoercible()` — opting an array/object param into JSON-string tolerance

The retired hand-rolled server had a generic `coerceArgs` step that
JSON-parsed any stringified object/array argument, for *any* registered tool
— including third-party ones — before validation. The official server
validates arguments against the input schema **before** your handler runs,
so there is no hook left to pre-parse anything generically. That tolerance is
gone by default for every tool, including this plugin's own.

`jsonCoercible()` (`server/src/lib/json-coercible.ts`) restores it on a
**per-parameter, opt-in** basis by wrapping the schema itself:

```ts
import { z } from 'zod';
import { jsonCoercible } from '../../lib/json-coercible';

export const searchContentSchema = z.object({
  contentType: z.string().describe('e.g. api::article.article'),
  filters: jsonCoercible(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Strapi filter object, e.g. { "title": { "$contains": "foo" } }'),
  fields: jsonCoercible(z.array(z.string()))
    .optional()
    .describe('Fields to return, e.g. ["title", "slug"]'),
});
```

It uses `z.preprocess`, not a `z.union`, deliberately: a union would emit
`anyOf` in the generated JSON Schema and would not actually coerce anything.
`z.preprocess` coerces at parse time while still emitting the wrapped
schema's own JSON Schema, so the client keeps seeing a typed array/object
parameter. Only strings that look like JSON (`{...}` or `[...]` after
trimming) are touched, so genuine string values — `populate: "*"` — pass
through untouched.

Within this plugin, `jsonCoercible()` is applied to exactly 8 complex
parameters across `createContent`, `updateContent`, `searchContent`,
`findOneContent`, and `aggregateContent` (`data`, `filters`, `fields`,
`populate`). **Third-party contributed tools taking object/array parameters
get no automatic coercion** — if your extension plugin's tool accepts, say, a
`tags: z.array(z.string())` parameter and expects to tolerate
`mcp-remote` clients sending `tags: '["a","b"]'` as a JSON string, wrap it
yourself with the same helper (copy the ~15-line function; it has no
dependency on anything ai-sdk-specific).

### `additionalProperties` and tool annotations are gone

The deleted Zod→JSON-Schema converter hard-set `additionalProperties: false`
on every schema and emitted `annotations: { readOnlyHint, destructiveHint }`
per tool. Strapi's own tool-registration type has no `annotations` field —
there is nowhere to put those hints anymore, and no equivalent for
`additionalProperties`. The MCP permission tiers (§4) are the replacement for
the semantic information `readOnlyHint`/`destructiveHint` used to carry;
there is no replacement for `additionalProperties: false` — Zod 4's default
JSON Schema output for `z.object()` does not set it.

---

## 7. Server instructions are gone (partial mitigation only)

There is no `instructions` hook anywhere in the official MCP service.
Plugins cannot set the string an MCP client receives at `initialize` time.
The retired server generated dynamic routing hints from every source's
`getMeta()` (`/strapi — ...`, `/youtube — ...`) specifically because clients
like Claude Desktop, under "load tools when needed," read `instructions` to
decide **whether to activate the server at all** — before any tool call, and
before any resource read.

The mitigation is the `strapi://ai-sdk/tools/guide` resource
(`server/src/mcp/resources/tool-guide.ts`), generated fresh on every read
from the current registry contents plus each source's `getMeta()`. This is
**not equivalent**: a resource is only readable *after* a client has already
decided to activate the server and connect. If a client's activation
heuristic depended on `instructions` content, that signal is gone, full
stop. The resource only helps once a session already exists — e.g. an agent
that reads it proactively to plan which tool to call next, or a human
inspecting available capabilities via an MCP inspector.

Treat this as a real, accepted regression, not a solved problem. If tool
descriptions alone aren't earning attention from a "lazy-load tools" client,
richer per-tool `description` text is the only remaining lever inside this
plugin's control.

---

## 8. The `yt-transcripts` content-type UID coupling — breaking-change hazard

`strapi-plugin-ai-sdk-yt-embeddings` registers a `strapi.db.lifecycles.subscribe()`
hook (`server/src/bootstrap.ts`) against a **hardcoded content-type UID**:

```ts
strapi.db.lifecycles.subscribe({
  models: ['plugin::ai-sdk-yt-transcripts.transcript'],
  async afterCreate({ result }) {
    // embeds the new transcript into pgvector
  },
});
```

This is a string literal, not a lookup through any published API or version
check. If `strapi-plugin-ai-sdk-yt-transcripts` ever renames its content type,
changes its plugin id, or restructures the schema fields the hook reads
(`videoId`, `title`, `fullTranscript`, `transcriptWithTimeCodes`), this
subscription **silently stops firing**. There is no error, no warning at
boot (the `try`/`catch` around subscription registration only guards against
`yt-transcripts` being absent entirely, logging
`"yt-transcript plugin not found, skipping YT lifecycle hook"` — it does not
detect "plugin present, UID changed"). New transcripts simply stop being
embedded, invisibly.

**If you maintain `yt-transcripts`:** treat renaming the `transcript`
content type UID as a breaking change for `yt-embeddings`, and coordinate the
version bump across both packages if you do it.

**If you maintain `yt-embeddings`:** there is no current mechanism to detect
this drift at boot. A tier-1 E2E assertion
(`tests/e2e/structural.test.ts`, "cross-plugin wiring" describe block) pins
that the UID exists and the lifecycle hook is registered against it, which at
least turns a silent regression into a failing test — but only when the E2E
suite is actually run (see §9).

---

## 9. E2E suites — unverified, prerequisites

`tests/e2e/` (this repo) contains two tiers, run with **vitest**:

| Command | Cost | What it checks |
|---|---|---|
| `npm run test:e2e` | Free — structural only, no tool execution | `tools/list` shape, permission-tier scoping, `/tool-sources`, `.describe()` preservation, the tool-guide resource, the UID coupling (§8), tool-name collisions |
| `E2E_LIVE=1 npm run test:e2e:live` | Real API calls (YouTube, OpenAI, Neon) | Fetches a transcript, waits for it to get embedded, semantic-searches it via MCP, and triggers a chat tool call |

**As of this migration, neither tier has been run.** They require a live
host that this work does not provision or touch:

- Strapi **>= 5.47** with `mcp: { enabled: true }` (§1)
- `strapi-plugin-ai-sdk`, `-yt-transcripts`, and `-yt-embeddings` all
  source-linked or installed at `^1.1.0`
- An **admin API token** granting all three `plugin::ai-sdk.mcp.*`
  permissions (read, write, destructive) — `test:e2e` asserts on `send_email`
  being visible, which lives in the destructive tier; a token missing any one
  tier fails the wrong assertions for a confusing reason
- Environment variables: `STRAPI_URL`, `STRAPI_ADMIN_TOKEN`, and optionally
  `STRAPI_READONLY_TOKEN` for the permission-scoping assertions (a
  read-tier-only token to prove write/destructive tools are actually absent,
  not just unauthorized)

Do not assume these suites are green. Run tier 1 before relying on any of the
claims in this document that it exists to pin.

---

## Related docs

- [`mcp-consolidation.md`](./mcp-consolidation.md) — why extension plugins
  register with the hub instead of running their own MCP server (historical
  rationale, still accurate).
- [`tool-standardization-spec.md`](./tool-standardization-spec.md) — the
  original hub/extension architecture spec and migration guide for
  converting a standalone-MCP plugin into an extension (historical, still
  accurate for that specific migration path).
- [`README.md`](../README.md) — end-user setup: enabling MCP, granting
  permissions, connecting a client.
