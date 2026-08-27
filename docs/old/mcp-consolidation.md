# Tool Plugin Strategy: Standalone vs ai-sdk Extensions

> **Superseded in part by [plugin-contract.md](./plugin-contract.md)** as of
> v1.1.0, which is the source of truth for the tool contract, namespacing,
> Zod rules, and MCP permission tiers. This document is retained for its
> historical rationale.

## Background

Several existing plugins have their own MCP servers: `strapi-content-embeddings`, `yt-embeddings-strapi-plugin`, `strapi-octolens-mentions-plugin`. These work standalone — users connect an LLM client directly to each plugin's MCP endpoint.

With `strapi-plugin-ai-sdk`'s tool registry, new tool plugins don't need their own MCP server. They can register tools with ai-sdk and get chat UI + MCP exposure for free.

## Decision

**Two-track approach:**

1. **Existing plugins stay as-is.** No breaking changes for current users. They keep their own MCP servers and work standalone.

2. **New tool plugins are ai-sdk extensions.** They declare `strapi-plugin-ai-sdk` as a peer dependency and register tools with its `toolRegistry` in bootstrap. No MCP boilerplate, no standalone mode.

## What an ai-sdk extension plugin looks like

An extension plugin is minimal — it exposes an `ai-tools` service that returns tool definitions. The ai-sdk discovers and registers them automatically with namespace prefixing:

```typescript
// strapi-plugin-ai-sdk-weather/server/src/services/ai-tools.ts
import { tools } from '../tools';

export default () => ({
  getTools() {
    return tools;
  },
});
```

```typescript
// strapi-plugin-ai-sdk-weather/server/src/tools/get-weather.ts
import { z } from 'zod';

export const getWeatherTool = {
  name: 'getWeather',
  description: 'Get current weather for a location',
  schema: z.object({
    city: z.string().describe('City name'),
  }),
  execute: async (args, strapi) => {
    // tool logic here
  },
};
```

The tool is then automatically available in:
- **Admin chat UI** (via ai-sdk's tool bridge)
- **MCP endpoint** (via ai-sdk's MCP server, exposed as `ai_sdk_weather__get_weather`)
- **Tools dropdown** as a separate plugin source (namespaced correctly)

No MCP server code, no transport setup, no session management.

> **Important:** Use the `ai-tools` service pattern — don't register tools directly with `toolRegistry.register()` in bootstrap. Direct registration bypasses namespacing, which means tools get lumped into "built-in" and don't appear as a separate plugin in the UI.

## Why this approach

| Concern | Standalone plugins (existing) | ai-sdk extensions (new) |
|---|---|---|
| MCP server | Each plugin runs its own | ai-sdk exposes all tools via one endpoint |
| Dependency on ai-sdk | None | Peer dependency (required) |
| Boilerplate | MCP setup, transport, sessions | Just `toolRegistry.register()` |
| Works without ai-sdk | Yes | No |
| Chat UI integration | Manual (if at all) | Automatic |

**Pros of this direction:**
- No breaking changes for existing users
- New plugins are dramatically simpler to build
- One MCP endpoint for all new tools — simpler client configuration
- Consistent chat UI experience across all tools
- Clear separation: old plugins are standalone, new plugins extend ai-sdk

**Cons / tradeoffs:**
- New extension plugins cannot be used without ai-sdk installed
- Two "styles" of plugin in the ecosystem (may confuse contributors)
- Existing plugins won't benefit from consolidation unless migrated later

## Naming convention

Extension plugins use the `strapi-plugin-ai-sdk-*` namespace:
- `strapi-plugin-ai-sdk-weather`
- `strapi-plugin-ai-sdk-analytics`
- `strapi-plugin-ai-sdk-social`

This makes it clear they belong to the ai-sdk family and require it as a dependency.

## Peer dependency setup

Extension plugins should enforce the ai-sdk dependency in `package.json`:

```json
{
  "peerDependencies": {
    "strapi-plugin-ai-sdk": ">=0.7.0"
  }
}
```

This gives users a clear error at install time if ai-sdk is missing.

## Related docs

- **[Tool Standardization Spec](./tool-standardization-spec.md)** — The full spec for building extension plugins: `ToolDefinition` interface, Zod-first standard, namespacing rules, step-by-step guide, and migration guide for converting standalone plugins.

## Migration callout

When migrating a standalone plugin to an extension, **keep all existing routes, controllers, and services** — only remove the MCP-specific parts (MCP server, MCP routes, MCP controllers, `@modelcontextprotocol/sdk` dependency). Existing REST endpoints may be in use by frontends, other services, or users' custom integrations.

**Keep:**
- REST routes (e.g., `GET /yt-transcript/:videoId`)
- Controllers that handle those routes
- Services that interact with the database
- Content types and their schemas

**Remove:**
- `mcp/` directory (server, transport, tools, schemas)
- MCP routes (`POST/GET/DELETE /mcp`)
- MCP controller
- MCP auth middleware
- `@modelcontextprotocol/sdk` dependency

  > **Update (v1.1.0):** this line used to describe only what a *standalone*
  > plugin should remove when converting to an extension. As of v1.1.0 it is
  > also accurate for `strapi-plugin-ai-sdk` itself — the hub's own
  > hand-rolled MCP server was replaced by a thin bridge onto Strapi's
  > official built-in MCP server (Strapi >= 5.47), and
  > `@modelcontextprotocol/sdk` was dropped from the hub's runtime
  > `dependencies` (it remains only as a `devDependency`, used by the E2E
  > test client). See [`plugin-contract.md`](./plugin-contract.md) for the
  > current architecture.

**Add:**
- `ai-tools` service exposing tool definitions
- Peer dependency on `strapi-plugin-ai-sdk`

## Future consideration

If an existing standalone plugin (e.g., content-embeddings) reaches a natural major version bump, it could be migrated to the extension model and republished under the ai-sdk namespace. But there's no urgency — only do this if the standalone version becomes a maintenance burden.
