# Plugin Tool Discovery & Enhanced Search

> **Superseded in part by [plugin-contract.md](./plugin-contract.md)** as of
> v1.1.0, which is the source of truth for the tool contract, namespacing,
> Zod rules, and MCP permission tiers. This document is retained for its
> historical rationale.

> RFC for enabling cross-plugin tool registration so the AI SDK can automatically
> discover and use tools from any installed Strapi plugin.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Analysis](#current-state-analysis)
3. [Proposed Architecture](#proposed-architecture)
4. [Tool Format Gap Analysis](#tool-format-gap-analysis)
5. [Implementation Plan](#implementation-plan)
6. [Enhanced Memory Search](#enhanced-memory-search)
7. [File-by-File Change Summary](#file-by-file-change-summary)
8. [Migration & Backwards Compatibility](#migration--backwards-compatibility)
9. [Open Questions](#open-questions)

---

## Problem Statement

The AI SDK plugin can already query any Strapi content type via `searchContent` and
`listContentTypes`. However, plugins like `octalens-mentions` and
`strapi-content-embeddings` expose **specialized tools** (BM25 search, vector
similarity search, RAG queries) that are currently only available through their
own MCP endpoints. There is no way for the AI SDK to leverage these capabilities.

**Goals:**

1. Any Strapi plugin can contribute tools to the AI SDK via a simple convention
2. The AI SDK remains the single orchestrator — one chat, one MCP endpoint, all tools
3. Memory recall upgrades from `$containsi` substring match to semantic vector search
   when the embeddings plugin is installed
4. Zero hard dependencies — everything is opt-in

---

## Current State Analysis

### AI SDK Plugin (`strapi-plugin-ai-sdk`)

| Aspect | Detail |
|--------|--------|
| **Tool Registry** | `ToolRegistry` class in `server/src/lib/tool-registry.ts` — in-memory `Map<string, ToolDefinition>` |
| **Tool Format** | `ToolDefinition` interface: `{ name, description, schema (Zod), execute, internal?, publicSafe? }` |
| **Built-in Tools** | 11 tools registered in `bootstrap.ts` from `builtInTools` array |
| **MCP Exposure** | `registry.getPublic()` → converts camelCase to snake_case → MCP server |
| **Memory Search** | `$containsi` substring match on `content` field — no semantic understanding |
| **Content Search** | Strapi's `_q` operator — basic built-in full-text search |

**Key file:** `server/src/bootstrap.ts` — tool registry initialized at lines 32-37

### Octolens Mentions Plugin (`strapi-octolens-mentions-plugin`)

| Aspect | Detail |
|--------|--------|
| **Tool Format** | MCP-native objects: `{ name, description, inputSchema: { type, properties, required } }` |
| **Handler Format** | `(strapi, args) => Promise<{ content: [{ type: 'text', text: string }] }>` |
| **Validation** | Zod via `validateToolInput()` in `mcp/schemas/index.ts` |
| **Tools Exposed** | `search_mentions` (BM25), `list_mentions`, `get_mention`, `update_mention` |
| **Registration** | Exported as array in `mcp/tools/index.ts`, used only by its own MCP server |

**Key file:** `server/src/mcp/tools/search-mentions.ts` — BM25 implementation (420 lines)

### Content Embeddings Plugin (`strapi-content-embeddings`)

| Aspect | Detail |
|--------|--------|
| **Tool Format** | MCP-native objects (same shape as octolens) |
| **Handler Format** | `(strapi, validatedArgs) => Promise<{ content: [{ type: 'text', text: string }] }>` |
| **Validation** | Zod via `validateToolInput()` in `mcp/schemas/index.ts` |
| **Tools Exposed** | `semantic_search`, `rag_query`, `list_embeddings`, `get_embedding`, `create_embedding` |
| **Vector Store** | pgvector on Neon PostgreSQL via LangChain `PGVectorStore` |
| **Core Service** | `pluginManager` singleton — `similaritySearch(query, k)`, `queryEmbedding(query)` |
| **Access Point** | Stored on `strapi.contentEmbeddingsManager` during bootstrap |

**Key file:** `server/src/plugin-manager.ts` — `similaritySearch()` at line 358, `queryEmbedding()` at line 279

---

## Proposed Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      AI SDK Plugin                            │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                  Tool Registry                           │ │
│  │                                                          │ │
│  │  ┌────────────────┐  ┌────────────────────────────────┐ │ │
│  │  │  Built-in (11) │  │  Discovered from plugins       │ │ │
│  │  │                │  │                                 │ │ │
│  │  │  searchContent │  │  search_mentions (octolens)    │ │ │
│  │  │  listContent.. │  │  list_mentions (octolens)      │ │ │
│  │  │  writeContent  │  │  semantic_search (embeddings)  │ │ │
│  │  │  findOneContent│  │  rag_query (embeddings)        │ │ │
│  │  │  aggregate..   │  │  ...                           │ │ │
│  │  │  saveMemory    │  │                                 │ │ │
│  │  │  recallMemory* │  │  (* upgraded with vector       │ │ │
│  │  │  ...           │  │     search when available)     │ │ │
│  │  └────────────────┘  └────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                            │                                  │
│              Exposed via: Chat + MCP                          │
└──────────────┬──────────────┬─────────────────────────────────┘
               │              │
       ┌───────▼───────┐  ┌──▼────────────────────┐
       │   Octolens     │  │  Content Embeddings   │
       │   Mentions     │  │                       │
       │                │  │  ai-tools service:    │
       │  ai-tools svc: │  │  - semantic_search    │
       │  - search_*    │  │  - rag_query          │
       │  - list_*      │  │  - list_embeddings    │
       │  - get_*       │  │  - get_embedding      │
       │  - update_*    │  │  - create_embedding   │
       └───────────────┘  └───────────────────────┘
```

### Convention: `ai-tools` Service

Any plugin that wants to contribute tools to the AI SDK exposes a Strapi service
named `ai-tools` with a single method:

```typescript
// In any plugin: server/src/services/ai-tools.ts
export default ({ strapi }) => ({
  getTools(): AiToolContribution[] {
    return [
      {
        name: 'tool_name',
        description: 'What this tool does',
        schema: z.object({ /* Zod schema */ }),
        execute: async (args, strapi, context?) => { /* returns result */ },
        // Optional flags:
        internal: false,    // default: false (exposed via MCP)
        publicSafe: false,  // default: false (admin-only)
      },
    ];
  },
});
```

The AI SDK discovers these during bootstrap and registers them into its
`ToolRegistry`. No coupling — if AI SDK isn't installed, the service is never
called. If a contributing plugin isn't installed, there's nothing to discover.

---

## Tool Format Gap Analysis

The three plugins currently use **two different tool formats**. This must be
reconciled for discovery to work.

### AI SDK Format (ToolDefinition)

```typescript
// server/src/lib/tool-registry.ts
interface ToolDefinition {
  name: string;                    // camelCase (e.g., "searchContent")
  description: string;
  schema: z.ZodObject<any>;        // Zod schema for validation
  execute: (
    args: any,
    strapi: Core.Strapi,
    context?: ToolContext            // { adminUserId?: number }
  ) => Promise<unknown>;            // Returns raw result object
  internal?: boolean;
  publicSafe?: boolean;
}
```

### MCP Plugin Format (Octolens & Embeddings)

```typescript
// Both plugins use this shape
interface McpToolDefinition {
  name: string;                     // snake_case (e.g., "search_mentions")
  description: string;
  inputSchema: {                    // JSON Schema (not Zod)
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

// Handlers return MCP-formatted response
type McpHandler = (strapi: Core.Strapi, args: unknown) =>
  Promise<{ content: [{ type: 'text'; text: string }] }>;
```

### Key Differences

| Aspect | AI SDK | Octolens / Embeddings |
|--------|--------|-----------------------|
| **Naming** | camelCase | snake_case |
| **Schema** | Zod object | JSON Schema object |
| **Return value** | Raw JS object | `{ content: [{ type: 'text', text: JSON.stringify(...) }] }` |
| **Validation** | Zod parse in tool wrapper | Zod via separate `validateToolInput()` |
| **Context** | Receives `ToolContext` (adminUserId) | No context parameter |

### Resolution Strategy

The `ai-tools` service contract uses the **AI SDK format** (Zod schema, raw
return values). Each contributing plugin adapts its existing tools in the
`ai-tools` service — this is a thin wrapper, not a rewrite.

**Why AI SDK format wins:**
- Zod schemas are already used internally by both MCP plugins for validation
- Raw return values are more flexible (the AI SDK wraps them for MCP or chat as needed)
- The AI SDK already handles camelCase ↔ snake_case conversion for MCP exposure
- Context passing (adminUserId) is important for tools that need user scoping

**Adapter example for an existing MCP tool:**

```typescript
// In octolens ai-tools service — wrapping existing handler
import { z } from 'zod';
import { handleSearchMentions } from '../mcp/tools/search-mentions';

{
  name: 'searchMentions',  // AI SDK convention: camelCase
  description: 'Search mentions using BM25 relevance scoring...',
  schema: z.object({
    query: z.string().optional(),
    source: z.string().optional(),
    // ... (mirrors existing inputSchema)
  }),
  execute: async (args, strapi) => {
    // Call existing handler, unwrap MCP envelope
    const mcpResult = await handleSearchMentions(strapi, args);
    return JSON.parse(mcpResult.content[0].text);
  },
}
```

This keeps the MCP tools working as-is while exposing them to AI SDK.

---

## Implementation Plan

### Phase 1: Tool Discovery Convention (AI SDK)

**Files to modify:**

#### 1.1 Define the contribution interface

**File:** `server/src/lib/tool-registry.ts`

Add the contribution interface alongside existing `ToolDefinition`:

```typescript
/**
 * Interface that external plugins implement to contribute tools.
 * Identical to ToolDefinition — defined separately for documentation clarity.
 */
export type AiToolContribution = ToolDefinition;
```

Export `ToolDefinition` and `ToolContext` (already exported) so other plugins can
import them as a dev dependency for type safety.

#### 1.2 Add plugin discovery to bootstrap

**File:** `server/src/bootstrap.ts`

After registering built-in tools (line 36), add discovery loop:

```typescript
// Discover tools from other plugins
for (const [pluginName, pluginInstance] of Object.entries(strapi.plugins)) {
  if (pluginName === PLUGIN_ID) continue;

  try {
    const aiToolsService = (pluginInstance as any).service?.('ai-tools');
    if (!aiToolsService?.getTools) continue;

    const contributedTools = aiToolsService.getTools();
    if (!Array.isArray(contributedTools)) continue;

    let registered = 0;
    for (const tool of contributedTools) {
      if (!tool.name || !tool.execute || !tool.schema) {
        strapi.log.warn(
          `[${PLUGIN_ID}] Skipping invalid tool from ${pluginName}: missing name, execute, or schema`
        );
        continue;
      }

      // Prefix to avoid collisions: "mentions:searchMentions"
      const prefixedName = `${pluginName}:${tool.name}`;
      if (toolRegistry.has(prefixedName)) {
        strapi.log.warn(`[${PLUGIN_ID}] Tool ${prefixedName} already registered, skipping`);
        continue;
      }

      toolRegistry.register({ ...tool, name: prefixedName });
      registered++;
    }

    if (registered > 0) {
      strapi.log.info(
        `[${PLUGIN_ID}] Discovered ${registered} tool(s) from plugin: ${pluginName}`
      );
    }
  } catch (err) {
    strapi.log.warn(
      `[${PLUGIN_ID}] Failed to discover tools from ${pluginName}: ${err}`
    );
  }
}
```

**Design decisions:**
- **Namespaced names** (`pluginName:toolName`) prevent collisions between plugins
  that might use the same tool names
- **Fail-safe** — a broken plugin can't crash AI SDK bootstrap
- **Validation** — skips tools missing required fields with a warning

#### 1.3 Update MCP server for namespaced tools

**File:** `server/src/mcp/server.ts`

The existing `toSnakeCase` function converts camelCase to snake_case. Namespaced
tool names like `octalens-mentions:searchMentions` need handling:

```typescript
function toMcpName(name: string): string {
  // "octalens-mentions:searchMentions" → "octalens_mentions__search_mentions"
  return name
    .replace(/:/g, '__')
    .replace(/-/g, '_')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
```

---

### Phase 2: Octolens Mentions — Contribute Tools

**New file:** `server/src/services/ai-tools.ts`

```typescript
import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { handleSearchMentions } from '../mcp/tools/search-mentions';
import { handleListMentions } from '../mcp/tools/list-mentions';
import { handleGetMention } from '../mcp/tools/get-mention';
import { handleUpdateMention } from '../mcp/tools/update-mention';

/** Unwrap MCP envelope → raw object */
function unwrapMcp(mcpResult: any): unknown {
  try {
    return JSON.parse(mcpResult.content[0].text);
  } catch {
    return mcpResult;
  }
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  getTools() {
    return [
      {
        name: 'searchMentions',
        description:
          'Search social mentions using BM25 relevance scoring. Title matches weighted 2x. Supports filtering by source, author, sentiment, keyword, bookmark status.',
        schema: z.object({
          query: z.string().optional().describe('BM25 search query across title and body'),
          source: z.string().optional().describe('Filter by platform (reddit, twitter, hackernews)'),
          author: z.string().optional().describe('Filter by author name'),
          keyword: z.string().optional().describe('Filter by tracked keyword'),
          sentimentLabel: z.string().optional().describe('Filter by sentiment'),
          bookmarked: z.boolean().optional().describe('Filter by bookmark status'),
          viewName: z.string().optional().describe('Filter by Octolens view name'),
          subreddit: z.string().optional().describe('Filter by subreddit'),
          page: z.number().optional().describe('Page number (default: 1)'),
          pageSize: z.number().optional().describe('Items per page (default: 25, max: 100)'),
          sort: z.string().optional().describe('Sort order (default: createdAt:desc)'),
        }),
        execute: async (args: any, strapi: Core.Strapi) => unwrapMcp(await handleSearchMentions(strapi, args)),
      },
      {
        name: 'listMentions',
        description: 'List all social mentions with pagination.',
        schema: z.object({
          page: z.number().optional(),
          pageSize: z.number().optional(),
          sort: z.string().optional(),
        }),
        execute: async (args: any, strapi: Core.Strapi) => unwrapMcp(await handleListMentions(strapi, args)),
      },
      {
        name: 'getMention',
        description: 'Get full details of a single social mention by document ID.',
        schema: z.object({
          documentId: z.string().describe('The document ID of the mention'),
        }),
        execute: async (args: any, strapi: Core.Strapi) => unwrapMcp(await handleGetMention(strapi, args)),
      },
      {
        name: 'updateMention',
        description: 'Update a mention (bookmark status or action: answered/pending/ignored).',
        schema: z.object({
          documentId: z.string().describe('The document ID of the mention'),
          data: z.object({
            bookmarked: z.boolean().optional(),
            action: z.string().optional(),
          }),
        }),
        execute: async (args: any, strapi: Core.Strapi) => unwrapMcp(await handleUpdateMention(strapi, args)),
      },
    ];
  },
});
```

**File to modify:** `server/src/services/index.ts`

Add `ai-tools` to the service exports:

```typescript
import aiTools from './ai-tools';

export default {
  mention,   // existing
  'ai-tools': aiTools,
};
```

---

### Phase 3: Content Embeddings — Contribute Tools

**New file:** `server/src/services/ai-tools.ts`

```typescript
import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { handleSemanticSearch } from '../mcp/tools/semantic-search';
import { handleRagQuery } from '../mcp/tools/rag-query';
import { handleListEmbeddings } from '../mcp/tools/list-embeddings';
import { handleGetEmbedding } from '../mcp/tools/get-embedding';
import { handleCreateEmbedding } from '../mcp/tools/create-embedding';

function unwrapMcp(mcpResult: any): unknown {
  try {
    return JSON.parse(mcpResult.content[0].text);
  } catch {
    return mcpResult;
  }
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  getTools() {
    return [
      {
        name: 'semanticSearch',
        description:
          'Vector similarity search across all embedded content. Uses cosine distance to find semantically related documents regardless of exact keyword matches.',
        schema: z.object({
          query: z.string().describe('Natural language search query'),
          limit: z.number().min(1).max(20).optional().describe('Number of results (default: 4)'),
        }),
        execute: async (args: any, strapi: Core.Strapi) =>
          unwrapMcp(await handleSemanticSearch(strapi, args)),
      },
      {
        name: 'ragQuery',
        description:
          'Ask a question and get an AI-generated answer grounded in embedded content. Uses retrieval-augmented generation (RAG) with vector search.',
        schema: z.object({
          query: z.string().describe('Question to answer using embedded knowledge'),
          includeSourceDocuments: z.boolean().optional().describe('Include source documents in response'),
        }),
        execute: async (args: any, strapi: Core.Strapi) =>
          unwrapMcp(await handleRagQuery(strapi, args)),
      },
      {
        name: 'listEmbeddings',
        description: 'List all embedded documents with pagination.',
        schema: z.object({
          page: z.number().optional(),
          pageSize: z.number().min(1).max(50).optional(),
          search: z.string().optional(),
        }),
        execute: async (args: any, strapi: Core.Strapi) =>
          unwrapMcp(await handleListEmbeddings(strapi, args)),
      },
      {
        name: 'getEmbedding',
        description: 'Get a specific embedded document by ID.',
        schema: z.object({
          documentId: z.string().describe('Document ID of the embedding'),
          includeContent: z.boolean().optional(),
        }),
        execute: async (args: any, strapi: Core.Strapi) =>
          unwrapMcp(await handleGetEmbedding(strapi, args)),
      },
      {
        name: 'createEmbedding',
        description: 'Create a new embedding from text content for future semantic search.',
        schema: z.object({
          title: z.string().describe('Title for the embedding'),
          content: z.string().describe('Text content to embed'),
          metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
          autoChunk: z.boolean().optional().describe('Auto-chunk large content'),
        }),
        execute: async (args: any, strapi: Core.Strapi) =>
          unwrapMcp(await handleCreateEmbedding(strapi, args)),
      },
    ];
  },
});
```

**File to modify:** `server/src/services/index.ts`

Add `ai-tools` to the service exports alongside existing services.

---

### Phase 4: Enhanced Memory Search (AI SDK)

Upgrade `recallMemories` and `recallPublicMemories` to use vector search when
the embeddings plugin is available.

**File:** `server/src/tool-logic/recall-memories.ts`

```typescript
import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolContext } from '../lib/tool-registry';

const CONTENT_TYPE = 'plugin::ai-sdk.memory' as const;

export const recallMemoriesSchema = z.object({
  query: z.string().optional().describe('Search term to filter memories by content'),
  category: z.string().optional().describe('Category filter (preference, project, personal)'),
});

export const recallMemoriesDescription =
  'Recall saved memories/facts about the user. Uses semantic search when available, otherwise keyword matching.';

export type RecallMemoriesParams = z.infer<typeof recallMemoriesSchema>;

export interface RecallMemoriesResult {
  success: boolean;
  memories: { content: string; category: string }[];
  count: number;
}

/**
 * Attempt semantic search via the content-embeddings plugin.
 * Returns null if the plugin is not installed or not initialized.
 */
async function semanticRecall(
  strapi: Core.Strapi,
  query: string,
  adminUserId: number
): Promise<RecallMemoriesResult | null> {
  try {
    const manager = (strapi as any).contentEmbeddingsManager;
    if (!manager?.isInitialized?.()) return null;

    const results = await manager.similaritySearch(query, 10);
    if (!results?.length) return null;

    // Filter results to only include memories belonging to this user
    // Embeddings metadata should include adminUserId and contentType
    const userMemories = results
      .filter((doc: any) => {
        const meta = doc.metadata || {};
        return (
          meta.collectionType === CONTENT_TYPE &&
          String(meta.adminUserId) === String(adminUserId)
        );
      })
      .map((doc: any) => ({
        content: doc.pageContent || doc.metadata?.title || '',
        category: doc.metadata?.category || 'general',
      }));

    if (userMemories.length === 0) return null;

    return {
      success: true,
      memories: userMemories,
      count: userMemories.length,
    };
  } catch {
    return null; // Fall back to substring search
  }
}

export async function recallMemories(
  strapi: Core.Strapi,
  params: RecallMemoriesParams,
  context?: ToolContext
): Promise<RecallMemoriesResult> {
  if (!context?.adminUserId) {
    return { success: false, memories: [], count: 0 };
  }

  try {
    // Try semantic search first (when query is provided and embeddings available)
    if (params.query) {
      const semanticResult = await semanticRecall(strapi, params.query, context.adminUserId);
      if (semanticResult) {
        // If category filter requested, apply it post-search
        if (params.category) {
          semanticResult.memories = semanticResult.memories.filter(
            (m) => m.category === params.category
          );
          semanticResult.count = semanticResult.memories.length;
        }
        return semanticResult;
      }
    }

    // Fallback: existing $containsi search
    const filters: Record<string, unknown> = { adminUserId: context.adminUserId };
    if (params.category) filters.category = params.category;
    if (params.query) filters.content = { $containsi: params.query };

    const memories = await strapi.documents(CONTENT_TYPE).findMany({
      filters,
      fields: ['content', 'category'],
      sort: { createdAt: 'desc' },
    });

    return {
      success: true,
      memories: memories.map((m: any) => ({ content: m.content, category: m.category })),
      count: memories.length,
    };
  } catch (error) {
    return { success: false, memories: [], count: 0 };
  }
}
```

**Note:** The same pattern applies to `recall-public-memories.ts` but without
the `adminUserId` filter.

**Prerequisite:** When saving memories (`save-memory.ts`), if the embeddings
plugin is available, also create an embedding for the memory content with
metadata `{ adminUserId, category, collectionType: CONTENT_TYPE }`. This ensures
semantic recall can find memories by meaning.

**File:** `server/src/tool-logic/save-memory.ts` — add after successful save:

```typescript
// Optionally embed the memory for semantic recall
try {
  const manager = (strapi as any).contentEmbeddingsManager;
  if (manager?.isInitialized?.()) {
    await manager.createEmbedding({
      id: result.documentId,
      title: params.content.substring(0, 100),
      content: params.content,
      collectionType: CONTENT_TYPE,
      fieldName: 'content',
    });
  }
} catch {
  // Non-critical — memory is saved, embedding is a bonus
}
```

---

## File-by-File Change Summary

### AI SDK Plugin (`strapi-plugin-ai-sdk`)

| File | Change | Effort |
|------|--------|--------|
| `server/src/lib/tool-registry.ts` | Export `AiToolContribution` type alias | Trivial |
| `server/src/bootstrap.ts` | Add plugin discovery loop after built-in tool registration | Small |
| `server/src/mcp/server.ts` | Update `toSnakeCase` → `toMcpName` to handle namespaced tool names | Small |
| `server/src/tool-logic/recall-memories.ts` | Add `semanticRecall()` fallback, try embeddings first | Medium |
| `server/src/tool-logic/recall-public-memories.ts` | Same pattern as recall-memories (no adminUserId) | Medium |
| `server/src/tool-logic/save-memory.ts` | Optionally create embedding on memory save | Small |
| `package.json` | No changes — no new dependencies | None |

### Octolens Mentions Plugin (`strapi-octolens-mentions-plugin`)

| File | Change | Effort |
|------|--------|--------|
| `server/src/services/ai-tools.ts` | **New file** — wraps existing MCP handlers as AI SDK tools | Medium |
| `server/src/services/index.ts` | Add `'ai-tools': aiTools` export | Trivial |

### Content Embeddings Plugin (`strapi-content-embeddings`)

| File | Change | Effort |
|------|--------|--------|
| `server/src/services/ai-tools.ts` | **New file** — wraps existing MCP handlers as AI SDK tools | Medium |
| `server/src/services/index.ts` | Add `'ai-tools': aiTools` export | Trivial |

### Total: ~6 modified files, 2 new files

---

## Migration & Backwards Compatibility

| Concern | Impact |
|---------|--------|
| **Existing MCP endpoints** | Unchanged. Each plugin keeps its own `/mcp` endpoint. The AI SDK MCP now also includes discovered tools. |
| **Existing AI SDK chat** | Works as before. New tools appear alongside built-in tools automatically. |
| **Plugins installed without AI SDK** | No effect. The `ai-tools` service is never called if AI SDK isn't present. |
| **AI SDK installed without other plugins** | No effect. Discovery loop finds nothing and logs nothing. |
| **Memory search** | Transparent upgrade. If embeddings plugin is present and memories are embedded, recall is semantic. Otherwise falls back to `$containsi`. |
| **Tool name collisions** | Prevented by `pluginName:toolName` namespacing. |

---

## Open Questions

1. **Should we auto-embed all memories on plugin install?** If a user installs the
   embeddings plugin after already having memories saved, existing memories won't
   have embeddings. Options: (a) run a one-time migration/sync, (b) embed lazily
   on next recall miss, (c) provide a manual sync command.

2. **Tool namespacing in chat UX.** Names like `octalens-mentions:searchMentions`
   are verbose for the AI. Consider whether the AI model handles this well or if
   shorter aliases should be supported.

3. **Should the RAG query tool in embeddings use the AI SDK's configured
   Anthropic model instead of hardcoded `gpt-4o-mini`?** This would make it
   provider-consistent but adds coupling.

4. **Public chat exposure.** Which discovered tools should be `publicSafe`? The
   contributing plugin should set this flag, but should the AI SDK have an
   override allowlist in its config?

5. **Tool ordering / priority.** When the AI has both `searchContent` (generic)
   and `searchMentions` (specialized BM25), it needs good descriptions to choose.
   Should the AI SDK inject a system prompt hint listing available specialized
   search tools and when to prefer them?
