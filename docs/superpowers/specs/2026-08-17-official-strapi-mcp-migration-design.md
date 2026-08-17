# Migrating to the official Strapi MCP server

**Status:** Approved, not yet implemented
**Date:** 2026-08-17
**Scope:** the three packages under `/Users/paul/work/plugin-dev/ai-sdk-plugins`
— `strapi-plugin-ai-sdk`, `strapi-plugin-ai-sdk-yt-embeddings`,
`strapi-plugin-ai-sdk-yt-transcripts`. No files outside that folder are
modified.

## Summary

Replace `strapi-plugin-ai-sdk`'s hand-rolled MCP server with the official
Strapi MCP server (built into Strapi 5.47+), and prove the three plugins work
together end to end.

Delivery stops at a reviewed branch in each of the three repos. Version numbers
are set in `package.json`, but nothing is published to npm and no host app is
touched.

The plugin stops owning transport, sessions, auth, and schema conversion.
It keeps its `ToolRegistry` — which the admin chat, the public widget chat,
and MCP all read from — and registers those tools onto Strapi's server via
`strapi.ai.mcp.registerTool`.

Net effect in the ai-sdk plugin: about 750 lines deleted, about 180 added.

## Background

### Current state

`strapi-plugin-ai-sdk` serves MCP itself:

| File | Responsibility |
|---|---|
| `server/src/mcp/server.ts` (523 lines) | Server factory, Zod→JSON-Schema converter, `coerceArgs`, `buildInstructions`, name conversion |
| `server/src/controllers/mcp.ts` (225 lines) | Session map, expiry sweeps, `StreamableHTTPServerTransport`, JSON-RPC errors |
| `server/src/routes/content-api/index.ts` | `POST`/`GET`/`DELETE /mcp` |
| `server/src/config/index.ts` | `mcp: { sessionTimeoutMs, maxSessions, cleanupInterval }` |

The endpoint is `/api/ai-sdk/mcp` with `policies: []`.

`ToolRegistry` (`server/src/lib/tool-registry.ts`) is **not** MCP-specific.
Three consumers read from it:

- `server/src/tools/index.ts` → `createTools()` for the admin chat
- `server/src/tools/index.ts` → `createPublicTools()` for the public widget
- `server/src/mcp/server.ts` → MCP exposure

Only the third is being replaced.

### The three plugins form a pipeline

They are not three independent tool providers. They are a chain, and the
links are implicit:

```
yt-transcripts   fetches a YouTube transcript
                 → plugin::ai-sdk-yt-transcripts.transcript
        ↓        lifecycle hook (yt-embeddings/server/src/bootstrap.ts:89)
                 subscribes to that exact model UID
yt-embeddings    chunks + embeds → Neon pgvector
                 → search-yt-knowledge tool
        ↓        ai-tools service discovery + getMeta
ai-sdk           namespaced registry → admin chat + public widget + MCP
```

Three seams break silently today because nothing tests them:

1. The hardcoded model UID `plugin::ai-sdk-yt-transcripts.transcript`
2. The `ai-tools` / `getMeta` service contract
3. The `__` namespacing that turns `searchYtKnowledge` into
   `ai_sdk_yt_embeddings__search_yt_knowledge`

### Test host (external prerequisite)

`strapi-local` is the E2E host. It sits outside this scope and is **not**
modified by this work; the following are prerequisites the maintainer performs
before phase 2 can run:

| Prerequisite | Current state |
|---|---|
| Strapi `>= 5.47` | on 5.39.0 — needs upgrading |
| `mcp: { enabled: true }` in `config/server.ts` | absent |
| An admin API token for the suite | not yet minted |
| The three plugins source-linked | already wired via `resolve: "../ai-sdk-plugins/..."` |

Note that strapi-local also hosts six unrelated plugins, so its Strapi upgrade
may surface breakage beyond these three. That is the maintainer's call, not
part of this work.

## Key finding: Strapi supports Zod 4

This corrects a claim in music-kb's `mcp-official-plugin-migration-plan.md`,
which states that `@strapi/utils` bundles Zod 3 and that every schema must
therefore be re-declared by hand. That is wrong, and the error is load-bearing
— it produced an entire hand-written schema catalog that this design does not
need.

`@strapi/utils/dist/zod.d.ts` reads:

```ts
import * as z from 'zod/v4';
/** Re-export of the Zod v4 schema builder from the same version Strapi uses
 *  internally. */
export { z };
```

The `"zod": "3.25.67"` dependency is the transition-line release that ships
the v4 API under `zod/v4`. Strapi is on Zod 4.

Verified against the real conversion path (MCP SDK 1.29):

- `@modelcontextprotocol/sdk/dist/esm/server/mcp.js` detects schemas by
  duck-typing — `'_def' in obj || '_zod' in obj` — with no `instanceof` check
  and no version identity check.
- `zod-json-schema-compat.js` branches on `isZ4Schema()` and converts Zod 4
  schemas with its own bundled `zod/v4-mini` `toJSONSchema()`.

A schema built with the plugin's own `zod@4.3.x` converts correctly through
that path. **Tool schemas pass through untouched. No converter, no catalog.**

### Corollary: prefer the plugin's own `zod` over `@strapi/utils`

Zod 4 stores `.describe()` text in a per-instance global registry. The SDK
converts using *its own* zod instance, which cannot see another instance's
registry. Measured:

| Schema built with | `.describe()` survives conversion |
|---|---|
| plugin `zod@4.3.6` | yes |
| `@strapi/utils` `z` | **no — silently dropped** |

So importing `z` from `@strapi/utils` would silently strip every parameter
description before it reached the client. This design imports `zod` directly.

> Aside, outside this scope: music-kb's `src/mcp/adapter.ts` and `catalog.ts`
> import `z` from `@strapi/utils` and are dense with `.describe()` calls. Its
> MCP tools are currently shipping parameters with no descriptions. Switching
> those two files to the app's `zod` import fixes it.

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Schema bridging | None needed — Zod 4 passes through |
| 2 | Cutover | Hard cut; delete the old stack in one release |
| 3 | Permission tiers | `read` / `write` / `destructive` |
| 4 | Extension plugins | No architectural change; ai-sdk stays the bridge |
| 5 | E2E host | `strapi-local` |
| 6 | External services | Two tiers: structural by default, live opt-in |
| 7 | Suite location | `strapi-plugin-ai-sdk` (the hub) |
| 8 | Alignment | Peer deps, compat check, lockstep versions, one contract doc |
| 9 | Delivery | Stops at a reviewed branch; no npm publish, no host changes |
| 10 | Versions | All three set to `1.1.0` in `package.json`, unpublished |

## Architecture

### Deleted

- `server/src/mcp/server.ts` — entire file
- `server/src/controllers/mcp.ts` — entire file
- The three `/mcp` routes in `routes/content-api/index.ts`
- The `mcp` config block in `config/index.ts`
- `createMcpServer`, `mcpSessions`, `MCPSession` from `lib/types.ts`,
  `bootstrap.ts`, `destroy.ts`
- The `mcp` export in `controllers/index.ts`
- `@modelcontextprotocol/sdk` from `dependencies` and `bundleDependencies`

### Unchanged

- `ToolRegistry` and all 14 built-in tool definitions
- `server/src/tool-logic/*`
- `ai-tools` discovery in `bootstrap.ts` (`discoverPluginTools`)
- Both chat paths, guardrails, widget, admin UI
- All REST routes for conversations, memories, tasks, notes
- Both `-yt-*` plugins' tool code and service contracts

### Added

`server/src/mcp/` is rebuilt as a bridge:

```
mcp/
  index.ts                 registerAiSdkMcpTools(strapi)
  permissions.ts           registers the 3 admin actions
  access.ts                tier derivation
  naming.ts                toSnakeCase / toTitle (salvaged from server.ts)
  size-guard.ts            1 MB wire-limit backstop
  resources/tool-guide.ts  kept; now served via registerResource
```

### The bridge

Called from `bootstrap.ts` **after** `discoverPluginTools()`, so contributed
tools are already registered:

```ts
export async function registerAiSdkMcpTools(strapi: Core.Strapi) {
  const mcp = strapi.ai?.mcp;
  if (!mcp?.isEnabled()) {
    strapi.log.info('[ai-sdk] Official MCP server disabled — skipping tools.');
    return;
  }

  await registerMcpAdminPermissions(strapi);

  const registry = (strapi.plugin('ai-sdk') as PluginInstance).toolRegistry;

  for (const [name, def] of registry.getPublic()) {
    mcp.registerTool({
      name: toSnakeCase(name),
      title: toTitle(name),
      description: def.description,
      resolveInputSchema: () => def.schema,
      resolveOutputSchema: () => LOOSE_OUTPUT,
      auth: { policies: [{ action: actionFor(def) }] },
      createHandler: (s) => async ({ args }) => {
        const result = guardSize(await def.execute(args ?? {}, s), def.name);
        const structuredContent =
          result && typeof result === 'object' && !Array.isArray(result)
            ? (result as Record<string, unknown>)
            : { result };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent,
        };
      },
    });
  }

  mcp.registerResource({ /* strapi://ai-sdk/tools/guide */ });
}
```

`bootstrap()` is a valid registration window; the API docs state both
`register()` and `bootstrap()` work and that bootstrap is preferred when
registration touches permissions or DB state, which this does.

### Output schemas

`resolveOutputSchema` is required and must be a `ZodObject`, but tools return
heterogeneous shapes. Use one permissive schema for all tools:

```ts
const LOOSE_OUTPUT = z.object({}).catchall(z.any());
```

Non-object returns are wrapped as `{ result }` so every tool satisfies the
contract. No per-tool work. Tightening individual output schemas is possible
later but is not part of this migration.

### Size guard

MCP clients reject results over roughly 1 MB with an opaque error the agent
cannot act on. The payload crosses the wire **twice** — once as `content` text
and once as `structuredContent` — so the effective size is about double the
serialized result. `searchContent` with a large `pageSize` can reach this.

`guardSize()` measures `bytes * 2 + 2048` against a 950,000-byte ceiling and,
when exceeded, substitutes a structured message naming the tool, the size, and
how to paginate. Ported from music-kb's `adapter.ts`, which arrived at these
numbers the hard way.

### Exposure scope

`getPublic()` filters out `internal: true`, so only 8 of the 14 built-ins reach
MCP: `listContentTypes`, `searchContent`, `findOneContent`, `aggregateContent`,
`createContent`, `updateContent`, `uploadMedia`, `sendEmail`. The memory, notes,
and task tools are chat-only.

`buildInstructions()` currently advertises `/memory`, `/notes`, and `/tasks` to
MCP clients — capabilities that are not exposed. Deleting it removes the
inconsistency. Whether those tools *should* be on MCP is a separate decision,
made by dropping `internal: true`, and is out of scope here.

## Permissions

ai-sdk is a plugin, so actions register under `section: 'plugins'`, yielding
`plugin::ai-sdk.*` ids:

```ts
await strapi.service('admin::permission').actionProvider.registerMany([
  { section: 'plugins', pluginName: 'ai-sdk', uid: 'mcp.read',
    displayName: 'Use read-only AI SDK MCP tools' },
  { section: 'plugins', pluginName: 'ai-sdk', uid: 'mcp.write',
    displayName: 'Use content-mutating AI SDK MCP tools' },
  { section: 'plugins', pluginName: 'ai-sdk', uid: 'mcp.destructive',
    displayName: 'Use irreversible / external-side-effect AI SDK MCP tools' },
]);
```

### Tier derivation

```ts
const tier = def.access ?? (def.publicSafe ? 'read' : 'write');
```

`publicSafe` already means "read-only and safe for anonymous chat", so it does
the work with no annotation:

| Tier | Tools | Source |
|---|---|---|
| read | `listContentTypes`, `searchContent`, `findOneContent`, `aggregateContent` | `publicSafe: true` |
| write | `createContent`, `updateContent`, `uploadMedia` | default |
| destructive | `sendEmail` | explicit `access` |
| read | all 9 `yt-transcripts` / `yt-embeddings` tools | `publicSafe: true` |

Only `sendEmail` needs a hand-set tier.

Add an optional field to `ToolDefinition`:

```ts
/** MCP permission tier. Defaults to 'read' when publicSafe, else 'write'. */
access?: 'read' | 'write' | 'destructive';
```

Backward compatible. Third-party plugins that never set it still tier
sensibly.

Because permission gating decides which tools appear in `tools/list` at all, a
read-scoped admin token yields a genuinely safe browse-only surface.

## Behavior changes

Four consequences, two of them regressions. All are accepted.

### 1. Server instructions are lost

There is no `instructions` hook anywhere in Strapi's MCP service — verified by
searching `@strapi/core/dist/services/mcp/`. Plugins cannot set them.

`buildInstructions()` generates the dynamic routing hints (`/strapi — …`,
`/youtube — …`, built from each source's `getMeta`). This is the primary signal
Claude Desktop uses under "load tools when needed" to decide whether to
activate a server. That capability goes away.

Mitigation: fold the content into the tool-guide resource, and absorb the
routing hints into individual tool descriptions. Partial recovery, not full.

### 2. `coerceArgs` cannot run

The SDK validates args against the input schema *before* the handler runs, so
there is no place to pre-parse stringified JSON. Clients — notably via
`mcp-remote` — that send `fields: '["title"]'` instead of `["title"]` will now
fail validation.

Mitigation: push coercion into the schemas themselves, where the SDK honors it:

```ts
fields: z.union([
  z.array(z.string()),
  z.string().transform((s) => JSON.parse(s)),
]).optional()
```

Apply to the array- and object-typed parameters that `coerceArgs` covers today.

### 3. Tools join Strapi's built-in CRUD tools

The official server is app-wide, so ai-sdk tools appear beside auto-generated
`list_<type>` / `get_<type>` tools that overlap `searchContent` and
`findOneContent`. Descriptions must earn their place so the model picks
correctly. There is no mechanism to disable built-in tools; gate them by
omitting permissions from the token.

### 4. Strapi floor rises

Peer dependency goes `^5.33.3` → `^5.47.0`. Users must also set
`mcp: { enabled: true }` in their own `config/server.ts` — the plugin cannot
enable it. Under the hard cut, users below 5.47 lose MCP entirely.

## Cross-plugin alignment

### Peer dependencies

Current ranges have drifted:

| Plugin | `@strapi/strapi` | `strapi-plugin-ai-sdk` |
|---|---|---|
| ai-sdk | `^5.33.3` | — |
| yt-embeddings | `^5.2.0` | **missing** |
| yt-transcripts | `^5.33.0` | `>=0.7.0` |

All three move to `@strapi/strapi: ^5.47.0`. `yt-embeddings` gains
`strapi-plugin-ai-sdk: ^1.1.0`, which it depends on just as hard as
yt-transcripts does — both for tool discovery and, in its case, for the
lifecycle-hook coupling.

### Compatibility check

`discoverPluginTools()` gains a version check. When a discovered plugin
declares a `strapi-plugin-ai-sdk` peer range that the running version does not
satisfy, log a clear warning naming both versions rather than failing later at
tool-registration time with an opaque error.

### Versions

Current: ai-sdk `0.11.0`, yt-embeddings `0.3.0`, yt-transcripts `1.0.3`.
Lockstep must clear the highest, so all three are set to **`1.1.0`**. The minor
bump signals the new Strapi floor and the MCP transport change. The numbers are
written into `package.json`; publishing is out of scope.

### Contract documentation

Consolidate into one source of truth, `docs/plugin-contract.md`, covering the
`ai-tools` + `getMeta` service contract, the `ToolDefinition` interface
including the new `access` field, namespacing rules, the MCP permission tiers,
and the `plugin::ai-sdk-yt-transcripts.transcript` model-UID coupling.

Supersedes the guidance currently spread across `mcp-consolidation.md`,
`plugin-tool-discovery.md`, and `tool-standardization-spec.md`. Those stay as
historical records with a pointer to the new doc.

## End-to-end testing

The suite lives in `strapi-plugin-ai-sdk/tests/e2e/` and runs against a running
`strapi-local`, configured by `STRAPI_URL` and `STRAPI_ADMIN_TOKEN`. Runner is
**vitest**, replacing the ad-hoc `tsx` / `node` scripts.

Because strapi-local carries live config, yt-embeddings connects to Neon and
OpenAI at bootstrap regardless. The tier split is therefore not "stubbed vs
real" but **"does asserting it cost anything"**.

### Tier 1 — structural (default, free)

`npm run test:e2e`. No tool execution, so no external API calls.

1. `tools/list` returns the 8 built-ins plus 9 namespaced `ai_sdk_yt_*` tools,
   with correct snake_case names
2. Permission scoping: a read-tier token sees read tools only; write and
   destructive tools are absent
3. `/tool-sources` lists three sources with their `getMeta` labels
4. **Every tool's emitted JSON Schema preserves its `.describe()` text** — the
   direct regression test for the Zod 4 pass-through, and for the exact failure
   mode found in music-kb
5. The `strapi://ai-sdk/tools/guide` resource reads back
6. `plugin::ai-sdk-yt-transcripts.transcript` exists and yt-embeddings'
   lifecycle hook is registered against that UID — pinning the hardcoded
   coupling
7. Tool-name collision check: no two registered tools share a name

Tier 1 gates every change.

### Tier 2 — live pipeline (opt-in)

`E2E_LIVE=1 npm run test:e2e:live`. Real keys, one short known video:

1. Fetch a transcript through the yt-transcripts tool
2. Assert the transcript document was created
3. Wait for the lifecycle hook; assert pgvector rows exist for that `videoId`
4. Call `search_yt_knowledge` through MCP; assert a semantic hit referencing
   the video
5. Send a chat prompt that should trigger a yt tool; assert the tool call
   occurred
6. Teardown: delete the transcript document and its embedding rows

Tier 2 runs before the branch is handed over for review.

### Retained tests

`test:api`, `test:chat`, `test:stream`, and `test:guardrails` cover the chat
paths, which this refactor does not touch. They must stay green unmodified —
they are the regression net proving the registry swap did not disturb chat.

`tests/mcp.test.ts` is rewritten against `/mcp` with an admin token and folded
into tier 1.

## Delivery path

Three phases, all confined to the three plugin packages.

### Phase 0 — Alignment

Peer deps to `^5.47.0` across all three; add the missing `strapi-plugin-ai-sdk`
peer dep to yt-embeddings; add the bootstrap compatibility check; write
`docs/plugin-contract.md`.

### Phase 1 — Refactor

The ai-sdk MCP swap: delete the old stack, add the bridge, permissions, access
tiers, size guard, and resource. Add schema-level arg coercion to replace
`coerceArgs`. Add the `access` field to `ToolDefinition`.

### Phase 2 — E2E

Build and link all three plugins into strapi-local. Write and run tier 1, then
tier 2. Fix what they find.

Depends on the strapi-local prerequisites above being in place. If the host is
not yet on 5.47+ with MCP enabled, phase 2 blocks; phases 0 and 1 do not.

Exit: both tiers green, existing chat tests green and unmodified.

### Done

Each of the three repos has a reviewed branch with its changes and its version
set to `1.1.0`. Publishing and any host-app rollout are the maintainer's, on
their own schedule.

## Risks

1. **Phase 2 depends on an external prerequisite.** The strapi-local upgrade to
   5.47+ is outside this scope, and that app hosts six unrelated plugins whose
   breakage could stall it. Phases 0 and 1 are independent and can complete
   regardless, so this delays verification rather than the work itself.
2. **Lost server instructions** may measurably degrade Claude Desktop's
   tool-loading behavior. Not observable until the plugins run against a real
   client. If it bites, the fallback is richer tool descriptions plus an
   upstream feature request.
3. **No integration test covers publish-time packaging.** The E2E suite runs
   against source-linked plugins, so a `files` / `exports` regression in
   `package.json` would not surface until publish. Mitigated by running
   `strapi-plugin verify` on all three in phase 0.

## Out of scope

- Publishing any package to npm
- Any change to `strapi-local` or `strapi-prod`, including their Strapi
  upgrades, MCP config, and deployment
- Tightening per-tool output schemas beyond `LOOSE_OUTPUT`
- Exposing the memory / notes / task tools over MCP
- Fixing music-kb's dropped `.describe()` text
- Any change to the two `-yt-*` plugins' tool logic or service contracts
