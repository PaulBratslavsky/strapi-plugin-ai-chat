# Official Strapi MCP Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `strapi-plugin-ai-sdk`'s hand-rolled MCP server with Strapi's built-in MCP server (5.47+), and prove all three ai-sdk plugins work together end to end.

**Architecture:** The `ToolRegistry` is shared by the admin chat, the public widget chat, and MCP. Only the MCP exposure layer is replaced. A thin bridge in `server/src/mcp/` registers each public tool onto `strapi.ai.mcp` during `bootstrap()`, gated by three custom admin permission actions. Transport, sessions, auth, and schema conversion become Strapi's responsibility. Tool schemas are Zod 4 and pass through untouched.

**Tech Stack:** TypeScript, Strapi 5.47+, Zod 4, Vitest, `@modelcontextprotocol/sdk` (dev-only, for the E2E client).

**Spec:** `docs/superpowers/specs/2026-08-17-official-strapi-mcp-migration-design.md`

## Global Constraints

- **Scope boundary:** modify only files under `/Users/paul/work/plugin-dev/ai-sdk-plugins`. Never edit `strapi-local` or `strapi-prod`.
- **Strapi floor:** `@strapi/strapi` peer dependency is `^5.47.0` in all three packages.
- **Versions:** all three packages set to `1.1.0`. Do not run `npm publish`.
- **Zod:** always `import { z } from 'zod'` (the package's own Zod 4). **Never** import `z` from `@strapi/utils` — it silently drops `.describe()` text during JSON Schema conversion.
- **Registration window:** all `strapi.ai.mcp.register*` calls happen in `bootstrap()`, before the MCP server starts. Registering later throws.
- **Tool handler return shape** is a strict discriminated union. Success: `{ content, structuredContent }`. Error: `{ content, isError: true }`. Never both.
- **Three git repos:** `strapi-plugin-ai-sdk`, `strapi-plugin-ai-sdk-yt-embeddings`, `strapi-plugin-ai-sdk-yt-transcripts`. Each has its own branch `feat/official-strapi-mcp-migration`. Commit in the repo you are editing.
- **Do not modify** existing chat tests (`test:api`, `test:chat`, `test:stream`, `test:guardrails`). They are the regression net.

---

## Phase 0 — Alignment

### Task 1: Align package metadata across all three plugins

**Files:**
- Modify: `strapi-plugin-ai-sdk/package.json`
- Modify: `strapi-plugin-ai-sdk-yt-embeddings/package.json`
- Modify: `strapi-plugin-ai-sdk-yt-transcripts/package.json`

**Interfaces:**
- Consumes: nothing
- Produces: all three packages at version `1.1.0` with `@strapi/strapi` peer `^5.47.0`; `yt-embeddings` declares a `strapi-plugin-ai-sdk` peer dependency.

- [ ] **Step 1: Create the branch in each of the three repos**

```bash
cd /Users/paul/work/plugin-dev/ai-sdk-plugins/strapi-plugin-ai-sdk-yt-embeddings
git checkout -b feat/official-strapi-mcp-migration
cd ../strapi-plugin-ai-sdk-yt-transcripts
git checkout -b feat/official-strapi-mcp-migration
```

(`strapi-plugin-ai-sdk` is already on this branch.)

- [ ] **Step 2: Update `strapi-plugin-ai-sdk/package.json`**

Set `"version": "1.1.0"`. In `peerDependencies`, change `"@strapi/strapi": "^5.33.3"` to `"@strapi/strapi": "^5.47.0"`. In `devDependencies`, change `"@strapi/strapi": "^5.33.3"` to `"^5.47.0"` and `"@strapi/typescript-utils": "^5.33.3"` to `"^5.47.0"`.

- [ ] **Step 3: Update `strapi-plugin-ai-sdk-yt-embeddings/package.json`**

Set `"version": "1.1.0"`. Replace the `peerDependencies` block's `"@strapi/strapi": "^5.2.0"` with `"^5.47.0"`, and add the missing ai-sdk peer:

```json
  "peerDependencies": {
    "strapi-plugin-ai-sdk": "^1.1.0",
    "@strapi/sdk-plugin": "^5.2.7",
    "@strapi/strapi": "^5.47.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0",
    "styled-components": "^6.1.13"
  },
```

Also change `"@strapi/strapi": "^5.2.0"` to `"^5.47.0"` in `devDependencies`.

- [ ] **Step 4: Update `strapi-plugin-ai-sdk-yt-transcripts/package.json`**

Set `"version": "1.1.0"`. In `peerDependencies`, change `"strapi-plugin-ai-sdk": ">=0.7.0"` to `"^1.1.0"` and `"@strapi/strapi": "^5.33.0"` to `"^5.47.0"`. Change `"@strapi/strapi": "^5.33.0"` to `"^5.47.0"` in `devDependencies`.

- [ ] **Step 5: Verify all three packages still build their manifests**

```bash
cd /Users/paul/work/plugin-dev/ai-sdk-plugins/strapi-plugin-ai-sdk && npm run verify
cd ../strapi-plugin-ai-sdk-yt-embeddings && npm run verify
cd ../strapi-plugin-ai-sdk-yt-transcripts && npm run verify
```

Expected: each prints a success summary with no errors. `verify` checks the `exports` map and `files` field, which is our only guard against a packaging regression since publishing is out of scope.

- [ ] **Step 6: Commit in each repo**

```bash
cd /Users/paul/work/plugin-dev/ai-sdk-plugins/strapi-plugin-ai-sdk
git add package.json
git commit -m "chore: align to Strapi 5.47 floor, version 1.1.0"

cd ../strapi-plugin-ai-sdk-yt-embeddings
git add package.json
git commit -m "chore: align to Strapi 5.47 floor, declare ai-sdk peer dep, version 1.1.0"

cd ../strapi-plugin-ai-sdk-yt-transcripts
git add package.json
git commit -m "chore: align to Strapi 5.47 floor, version 1.1.0"
```

---

### Task 2: Set up Vitest and the fake-Strapi test harness

Everything in Phase 1 is unit-tested against a fake `strapi` object, so the refactor can be completed and verified without a running Strapi host.

**Files:**
- Create: `strapi-plugin-ai-sdk/vitest.config.ts`
- Create: `strapi-plugin-ai-sdk/tests/helpers/fake-strapi.ts`
- Create: `strapi-plugin-ai-sdk/tests/helpers/fake-strapi.test.ts`
- Modify: `strapi-plugin-ai-sdk/package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `createFakeStrapi(): { strapi, captured }` where `captured` is `{ tools: any[]; resources: any[]; actions: any[] }`. Scripts `test:unit` and `test:e2e`.

- [ ] **Step 1: Add Vitest and the dev-only MCP SDK**

```bash
cd /Users/paul/work/plugin-dev/ai-sdk-plugins/strapi-plugin-ai-sdk
npm install --save-dev vitest@^3.2.4
```

Note: `@modelcontextprotocol/sdk` is currently a *runtime* dependency. Task 10 removes it from `dependencies`; Task 12 re-adds it under `devDependencies` for the E2E client. Leave it alone for now.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    testTimeout: 10_000,
  },
});
```

The `exclude` keeps the host-dependent E2E suite out of the default run; Task 12 gives it its own config.

- [ ] **Step 3: Add scripts to `package.json`**

In `"scripts"`, add:

```json
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
```

- [ ] **Step 4: Write the fake-Strapi harness**

Create `tests/helpers/fake-strapi.ts`:

```ts
import type { Core } from '@strapi/strapi';

export interface Captured {
  tools: any[];
  resources: any[];
  actions: any[];
  logs: { level: string; message: string }[];
}

export interface FakeStrapiOptions {
  /** When false, strapi.ai.mcp.isEnabled() returns false. Default true. */
  mcpEnabled?: boolean;
  /** When false, strapi.ai is undefined (simulates Strapi < 5.47). Default true. */
  hasAiNamespace?: boolean;
}

/**
 * Minimal stand-in for Core.Strapi covering only what the MCP bridge touches:
 * the logger, the admin permission service, and the strapi.ai.mcp namespace.
 * Everything registered is recorded in `captured` for assertions.
 */
export function createFakeStrapi(options: FakeStrapiOptions = {}): {
  strapi: Core.Strapi;
  captured: Captured;
} {
  const { mcpEnabled = true, hasAiNamespace = true } = options;

  const captured: Captured = { tools: [], resources: [], actions: [], logs: [] };

  const log = (level: string) => (message: string) => {
    captured.logs.push({ level, message });
  };

  const ai = hasAiNamespace
    ? {
        mcp: {
          isEnabled: () => mcpEnabled,
          isRunning: () => false,
          registerTool: (tool: any) => captured.tools.push(tool),
          registerResource: (resource: any) => captured.resources.push(resource),
          registerPrompt: () => undefined,
          start: async () => undefined,
          stop: async () => undefined,
        },
      }
    : undefined;

  const strapi = {
    log: {
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
      debug: log('debug'),
    },
    service: (uid: string) => {
      if (uid === 'admin::permission') {
        return {
          actionProvider: {
            registerMany: async (defs: any[]) => {
              captured.actions.push(...defs);
            },
          },
        };
      }
      return undefined;
    },
    ai,
  } as unknown as Core.Strapi;

  return { strapi, captured };
}
```

- [ ] **Step 5: Write a test proving the harness records registrations**

Create `tests/helpers/fake-strapi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFakeStrapi } from './fake-strapi';

describe('createFakeStrapi', () => {
  it('records registered tools and resources', () => {
    const { strapi, captured } = createFakeStrapi();
    strapi.ai!.mcp.registerTool({ name: 'a' } as any);
    strapi.ai!.mcp.registerResource({ name: 'b' } as any);
    expect(captured.tools).toHaveLength(1);
    expect(captured.resources).toHaveLength(1);
  });

  it('records admin actions registered through the permission service', async () => {
    const { strapi, captured } = createFakeStrapi();
    await (strapi.service('admin::permission') as any).actionProvider.registerMany([
      { uid: 'mcp.read' },
    ]);
    expect(captured.actions).toEqual([{ uid: 'mcp.read' }]);
  });

  it('can simulate Strapi without the ai namespace', () => {
    const { strapi } = createFakeStrapi({ hasAiNamespace: false });
    expect(strapi.ai).toBeUndefined();
  });

  it('can simulate MCP being disabled', () => {
    const { strapi } = createFakeStrapi({ mcpEnabled: false });
    expect(strapi.ai!.mcp.isEnabled()).toBe(false);
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:unit`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts tests/helpers/ package.json package-lock.json
git commit -m "test: add vitest and fake-strapi harness for MCP bridge tests"
```

---

## Phase 1 — Refactor

### Task 3: Add the `access` tier field and derivation

**Files:**
- Modify: `strapi-plugin-ai-sdk/server/src/lib/tool-registry.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/tools/definitions/send-email.ts`
- Create: `strapi-plugin-ai-sdk/server/src/mcp/access.ts`
- Create: `strapi-plugin-ai-sdk/tests/mcp/access.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `lib/tool-registry`
- Produces: `type AccessTier = 'read' | 'write' | 'destructive'`; `MCP_ACTIONS: Record<AccessTier, string>`; `tierFor(def): AccessTier`; `actionFor(def): string`. `ToolDefinition` gains `access?: AccessTier`.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/access.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MCP_ACTIONS, tierFor, actionFor } from '../../server/src/mcp/access';

describe('tierFor', () => {
  it('defaults to write when nothing is declared', () => {
    expect(tierFor({})).toBe('write');
  });

  it('derives read from publicSafe', () => {
    expect(tierFor({ publicSafe: true })).toBe('read');
  });

  it('prefers an explicit access field over publicSafe', () => {
    expect(tierFor({ publicSafe: true, access: 'destructive' })).toBe('destructive');
    expect(tierFor({ publicSafe: false, access: 'read' })).toBe('read');
  });
});

describe('actionFor', () => {
  it('maps each tier to its namespaced admin action', () => {
    expect(actionFor({ publicSafe: true })).toBe('plugin::ai-sdk.mcp.read');
    expect(actionFor({})).toBe('plugin::ai-sdk.mcp.write');
    expect(actionFor({ access: 'destructive' })).toBe('plugin::ai-sdk.mcp.destructive');
  });
});

describe('MCP_ACTIONS', () => {
  it('exposes exactly three tiers under the plugin::ai-sdk namespace', () => {
    expect(Object.keys(MCP_ACTIONS).sort()).toEqual(['destructive', 'read', 'write']);
    for (const action of Object.values(MCP_ACTIONS)) {
      expect(action.startsWith('plugin::ai-sdk.mcp.')).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- access`
Expected: FAIL — cannot resolve `../../server/src/mcp/access`.

- [ ] **Step 3: Create `server/src/mcp/access.ts`**

```ts
/**
 * MCP permission tiers.
 *
 * The official Strapi MCP server gates every custom tool behind an admin
 * permission action. A tool's tier decides which action guards it, and
 * because permission gating also filters `tools/list`, a read-scoped token
 * yields a genuinely browse-only surface.
 */
export type AccessTier = 'read' | 'write' | 'destructive';

export const MCP_ACTIONS: Record<AccessTier, string> = {
  read: 'plugin::ai-sdk.mcp.read',
  write: 'plugin::ai-sdk.mcp.write',
  destructive: 'plugin::ai-sdk.mcp.destructive',
};

/** The subset of ToolDefinition that tiering depends on. */
export interface Tierable {
  access?: AccessTier;
  publicSafe?: boolean;
}

/**
 * Resolve a tool's tier. An explicit `access` always wins. Otherwise
 * `publicSafe` (which already means "read-only and safe for anonymous
 * chat") implies read, and everything else defaults to write — the safe
 * default for third-party tools that declare neither.
 */
export function tierFor(def: Tierable): AccessTier {
  return def.access ?? (def.publicSafe ? 'read' : 'write');
}

export function actionFor(def: Tierable): string {
  return MCP_ACTIONS[tierFor(def)];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- access`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the `access` field to `ToolDefinition`**

In `server/src/lib/tool-registry.ts`, add the import at the top:

```ts
import type { AccessTier } from '../mcp/access';
```

Then inside `export interface ToolDefinition`, after the `publicSafe` field, add:

```ts
  /**
   * MCP permission tier. Defaults to 'read' when publicSafe is true,
   * otherwise 'write'. Set explicitly for tools whose risk does not match
   * that default — e.g. irreversible or external-side-effect tools.
   */
  access?: AccessTier;
```

- [ ] **Step 6: Mark `sendEmail` destructive**

In `server/src/tools/definitions/send-email.ts`, add `access: 'destructive'` to the exported object so it reads:

```ts
export const sendEmailTool: ToolDefinition = {
  name: 'sendEmail',
  description: sendEmailDescription,
  schema: sendEmailSchema,
  execute: async (args, strapi) => sendEmail(strapi, args),
  internal: false,
  access: 'destructive',
};
```

- [ ] **Step 7: Type-check**

Run: `npm run test:ts:back`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/mcp/access.ts server/src/lib/tool-registry.ts server/src/tools/definitions/send-email.ts tests/mcp/access.test.ts
git commit -m "feat: add read/write/destructive MCP access tiers"
```

---

### Task 4: Salvage tool-name conversion into `naming.ts`

`toSnakeCase`, `toTitle`, and `getToolSource` currently live inside `mcp/server.ts`, which Task 10 deletes. Extract them first, with tests they never had.

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/mcp/naming.ts`
- Create: `strapi-plugin-ai-sdk/tests/mcp/naming.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `toSnakeCase(name: string): string`; `getToolSource(name: string): string`; `toTitle(name: string): string`. All take a **registry** name (e.g. `searchContent`, `ai_sdk_yt_transcripts__getTranscript`).

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/naming.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toSnakeCase, toTitle, getToolSource } from '../../server/src/mcp/naming';

describe('toSnakeCase', () => {
  it('converts a camelCase built-in name', () => {
    expect(toSnakeCase('searchContent')).toBe('search_content');
  });

  it('preserves the double-underscore namespace separator', () => {
    expect(toSnakeCase('ai_sdk_yt_transcripts__getTranscript')).toBe(
      'ai_sdk_yt_transcripts__get_transcript',
    );
  });

  it('converts colons to double underscores and hyphens to underscores', () => {
    expect(toSnakeCase('some-plugin:doThing')).toBe('some_plugin__do_thing');
  });
});

describe('getToolSource', () => {
  it('reports built-in for unnamespaced names', () => {
    expect(getToolSource('searchContent')).toBe('built-in');
  });

  it('extracts the namespace prefix', () => {
    expect(getToolSource('ai_sdk_yt_embeddings__searchYtKnowledge')).toBe(
      'ai_sdk_yt_embeddings',
    );
  });
});

describe('toTitle', () => {
  it('prefixes built-in tools with Strapi', () => {
    expect(toTitle('searchContent')).toBe('Strapi: Search Content');
  });

  it('prefixes plugin tools with their hyphenated source', () => {
    expect(toTitle('ai_sdk_yt_transcripts__getTranscript')).toBe(
      'ai-sdk-yt-transcripts: Get Transcript',
    );
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- naming`
Expected: FAIL — cannot resolve `../../server/src/mcp/naming`.

- [ ] **Step 3: Create `server/src/mcp/naming.ts`**

```ts
/**
 * Registry names are camelCase and may carry a `<source>__` namespace prefix
 * added during plugin tool discovery. MCP clients expect snake_case, matching
 * the convention of Strapi's own built-in tools (list_article, get_article).
 */

/** Convert a registry name to its MCP name. */
export function toSnakeCase(str: string): string {
  return str
    .replace(/:/g, '__')
    .replace(/-/g, '_')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Resolve which plugin contributed a tool, or 'built-in'. */
export function getToolSource(name: string): string {
  const sep = name.indexOf('__');
  return sep === -1 ? 'built-in' : name.substring(0, sep);
}

/** Human-readable title, e.g. "Strapi: Search Content". */
export function toTitle(name: string): string {
  const mcpName = toSnakeCase(name);
  const source = getToolSource(name);
  const prefix = source === 'built-in' ? 'Strapi' : source.replace(/_/g, '-');
  const shortName = mcpName
    .replace(/^[a-z_]+__/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${prefix}: ${shortName}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- naming`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/naming.ts tests/mcp/naming.test.ts
git commit -m "refactor: extract MCP tool-name conversion into naming.ts"
```

---

### Task 5: Add the oversized-result guard

MCP clients reject results over roughly 1 MB with an opaque error the agent cannot act on. The payload crosses the wire twice — once as `content` text, once as `structuredContent` — so measure double.

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/mcp/size-guard.ts`
- Create: `strapi-plugin-ai-sdk/tests/mcp/size-guard.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `MAX_WIRE_BYTES: number`; `guardSize(result: unknown, toolName: string): unknown`.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/size-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { guardSize, MAX_WIRE_BYTES } from '../../server/src/mcp/size-guard';

describe('guardSize', () => {
  it('passes small results through unchanged', () => {
    const result = { items: [1, 2, 3] };
    expect(guardSize(result, 'searchContent')).toBe(result);
  });

  it('replaces oversized results with a structured notice', () => {
    // One char per byte; * 2 for the doubled wire cost puts this over the limit.
    const huge = { blob: 'x'.repeat(MAX_WIRE_BYTES) };
    const guarded = guardSize(huge, 'searchContent') as Record<string, unknown>;

    expect(guarded.error).toBe('RESULT_TOO_LARGE');
    expect(guarded.tool).toBe('searchContent');
    expect(guarded.limitBytes).toBe(MAX_WIRE_BYTES);
    expect(typeof guarded.message).toBe('string');
    expect(guarded.message as string).toContain('pageSize');
  });

  it('accounts for the payload being sent twice', () => {
    // Just over half the limit: fine as one copy, too big when doubled.
    const justOverHalf = { blob: 'x'.repeat(Math.floor(MAX_WIRE_BYTES / 2)) };
    const guarded = guardSize(justOverHalf, 'searchContent') as Record<string, unknown>;
    expect(guarded.error).toBe('RESULT_TOO_LARGE');
  });

  it('handles undefined results without throwing', () => {
    expect(guardSize(undefined, 'someTool')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- size-guard`
Expected: FAIL — cannot resolve `../../server/src/mcp/size-guard`.

- [ ] **Step 3: Create `server/src/mcp/size-guard.ts`**

```ts
/**
 * MCP clients reject a tool result over ~1 MB with an opaque
 * "Tool result is too large" error the agent cannot act on. We guard just
 * under that so the agent instead receives a structured, actionable message
 * and can re-issue the call with pagination.
 *
 * CRUCIAL: the result rides the wire TWICE — once as JSON text in `content`
 * and once as `structuredContent` — so the payload is roughly 2x the
 * serialized result. Measure the doubled size, not one copy.
 */
export const MAX_WIRE_BYTES = 950_000;

/** Per-tool hints for making an oversized result smaller. */
function shrinkHint(toolName: string): string {
  switch (toolName) {
    case 'searchContent':
      return 'Re-issue with a smaller pageSize, narrow `fields`, or leave includeContent false.';
    case 'aggregateContent':
      return 'Narrow the date range or group by a lower-cardinality field.';
    case 'findOneContent':
      return 'Request specific `fields` instead of the whole document, or reduce `populate`.';
    default:
      return 'Re-issue with pagination / a smaller page size, or request fewer fields.';
  }
}

/**
 * Return `result` unchanged when it fits, or a structured notice when it
 * would blow the client's limit.
 */
export function guardSize(result: unknown, toolName: string): unknown {
  const serialized = JSON.stringify(result);
  if (serialized === undefined) return result;

  const bytes = Buffer.byteLength(serialized, 'utf8');
  const wireBytes = bytes * 2 + 2048;
  if (wireBytes <= MAX_WIRE_BYTES) return result;

  return {
    error: 'RESULT_TOO_LARGE',
    tool: toolName,
    bytes: wireBytes,
    limitBytes: MAX_WIRE_BYTES,
    message: `This ${toolName} result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire (sent twice), over the ~1 MB MCP response limit. ${shrinkHint(toolName)}`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- size-guard`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/size-guard.ts tests/mcp/size-guard.test.ts
git commit -m "feat: guard MCP results against the 1MB client limit"
```

---

### Task 6: Register the custom admin permissions

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/mcp/permissions.ts`
- Create: `strapi-plugin-ai-sdk/tests/mcp/permissions.test.ts`

**Interfaces:**
- Consumes: `AccessTier` from `mcp/access`
- Produces: `MCP_ACTION_DEFS: ActionDef[]`; `registerMcpAdminPermissions(strapi: Core.Strapi): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { registerMcpAdminPermissions, MCP_ACTION_DEFS } from '../../server/src/mcp/permissions';
import { MCP_ACTIONS } from '../../server/src/mcp/access';

describe('registerMcpAdminPermissions', () => {
  it('registers one action per tier', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi);
    expect(captured.actions).toHaveLength(3);
  });

  it('registers under the plugins section scoped to ai-sdk', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi);
    for (const action of captured.actions) {
      expect(action.section).toBe('plugins');
      expect(action.pluginName).toBe('ai-sdk');
      expect(typeof action.displayName).toBe('string');
    }
  });

  it('uses uids that resolve to the action ids in MCP_ACTIONS', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi);
    const resolved = captured.actions.map((a) => `plugin::ai-sdk.${a.uid}`).sort();
    expect(resolved).toEqual(Object.values(MCP_ACTIONS).sort());
  });

  it('exports the definitions for reuse', () => {
    expect(MCP_ACTION_DEFS).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- permissions`
Expected: FAIL — cannot resolve `../../server/src/mcp/permissions`.

- [ ] **Step 3: Create `server/src/mcp/permissions.ts`**

```ts
// Custom admin permissions for this plugin's MCP tools.
//
// The official server gates each custom tool behind an `auth.policies` action
// string, and that action must exist in the admin permission registry before a
// token can be granted it. A tool only appears in `tools/list` when the
// connecting token's ability satisfies its policy.
//
// ai-sdk is a plugin, so registration uses `section: 'plugins'` with
// `pluginName`, which yields action ids under the `plugin::ai-sdk.` prefix.
import type { Core } from '@strapi/strapi';

export interface McpActionDef {
  section: 'plugins';
  pluginName: 'ai-sdk';
  uid: string;
  displayName: string;
}

export const MCP_ACTION_DEFS: McpActionDef[] = [
  {
    section: 'plugins',
    pluginName: 'ai-sdk',
    uid: 'mcp.read',
    displayName: 'Use read-only AI SDK MCP tools',
  },
  {
    section: 'plugins',
    pluginName: 'ai-sdk',
    uid: 'mcp.write',
    displayName: 'Use content-mutating AI SDK MCP tools',
  },
  {
    section: 'plugins',
    pluginName: 'ai-sdk',
    uid: 'mcp.destructive',
    displayName: 'Use irreversible / external-side-effect AI SDK MCP tools',
  },
];

export async function registerMcpAdminPermissions(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany(MCP_ACTION_DEFS);
  strapi.log.info(
    `[ai-sdk:mcp] Registered ${MCP_ACTION_DEFS.length} custom admin permission(s).`,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- permissions`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/permissions.ts tests/mcp/permissions.test.ts
git commit -m "feat: register plugin::ai-sdk.mcp admin permission actions"
```

---

### Task 7: Build the MCP bridge

The core of the migration. Registers every public registry tool onto `strapi.ai.mcp`.

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/mcp/register-tools.ts`
- Create: `strapi-plugin-ai-sdk/tests/mcp/register-tools.test.ts`

**Interfaces:**
- Consumes: `toSnakeCase`, `toTitle` from `mcp/naming`; `actionFor` from `mcp/access`; `guardSize` from `mcp/size-guard`; `ToolRegistry`, `ToolDefinition` from `lib/tool-registry`
- Produces: `LOOSE_OUTPUT: z.ZodObject<any>`; `registerToolsOnMcp(strapi: Core.Strapi, registry: ToolRegistry): number` returning the number of tools registered.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/register-tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import { registerToolsOnMcp } from '../../server/src/mcp/register-tools';

function registryWith(...defs: any[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const def of defs) registry.register(def);
  return registry;
}

const readTool = {
  name: 'searchContent',
  description: 'Search content',
  schema: z.object({ contentType: z.string().describe('The UID') }),
  execute: async () => ({ results: [1, 2] }),
  publicSafe: true,
};

const writeTool = {
  name: 'createContent',
  description: 'Create content',
  schema: z.object({ contentType: z.string() }),
  execute: async () => ({ ok: true }),
};

const internalTool = {
  name: 'saveMemory',
  description: 'Save a memory',
  schema: z.object({ content: z.string() }),
  execute: async () => ({ ok: true }),
  internal: true,
};

describe('registerToolsOnMcp', () => {
  it('registers public tools and skips internal ones', () => {
    const { strapi, captured } = createFakeStrapi();
    const count = registerToolsOnMcp(strapi, registryWith(readTool, writeTool, internalTool));

    expect(count).toBe(2);
    expect(captured.tools.map((t) => t.name).sort()).toEqual([
      'create_content',
      'search_content',
    ]);
  });

  it('gates each tool by its derived permission action', () => {
    const { strapi, captured } = createFakeStrapi();
    registerToolsOnMcp(strapi, registryWith(readTool, writeTool));

    const byName = Object.fromEntries(captured.tools.map((t) => [t.name, t]));
    expect(byName.search_content.auth).toEqual({
      policies: [{ action: 'plugin::ai-sdk.mcp.read' }],
    });
    expect(byName.create_content.auth).toEqual({
      policies: [{ action: 'plugin::ai-sdk.mcp.write' }],
    });
  });

  it('passes the tool schema through untouched, preserving descriptions', () => {
    const { strapi, captured } = createFakeStrapi();
    registerToolsOnMcp(strapi, registryWith(readTool));

    const resolved = captured.tools[0].resolveInputSchema({} as any);
    expect(resolved).toBe(readTool.schema);
    expect(resolved.shape.contentType.description).toBe('The UID');
  });

  it('supplies a permissive object output schema', () => {
    const { strapi, captured } = createFakeStrapi();
    registerToolsOnMcp(strapi, registryWith(readTool));

    const output = captured.tools[0].resolveOutputSchema({} as any);
    expect(output.parse({ anything: 1, nested: { a: 2 } })).toEqual({
      anything: 1,
      nested: { a: 2 },
    });
  });

  it('returns content plus structuredContent on success', async () => {
    const { strapi, captured } = createFakeStrapi();
    registerToolsOnMcp(strapi, registryWith(readTool));

    const handler = captured.tools[0].createHandler(strapi, {} as any);
    const result = await handler({ args: { contentType: 'api::a.a' } });

    expect(result.structuredContent).toEqual({ results: [1, 2] });
    expect(result.content[0].text).toBe(JSON.stringify({ results: [1, 2] }));
    expect(result.isError).toBeUndefined();
  });

  it('wraps non-object results so structuredContent stays an object', async () => {
    const { strapi, captured } = createFakeStrapi();
    registerToolsOnMcp(
      strapi,
      registryWith({ ...readTool, execute: async () => [1, 2, 3] }),
    );

    const handler = captured.tools[0].createHandler(strapi, {} as any);
    const result = await handler({ args: {} });
    expect(result.structuredContent).toEqual({ result: [1, 2, 3] });
  });

  it('returns isError without structuredContent when the tool throws', async () => {
    const { strapi, captured } = createFakeStrapi();
    registerToolsOnMcp(
      strapi,
      registryWith({
        ...readTool,
        execute: async () => {
          throw new Error('boom');
        },
      }),
    );

    const handler = captured.tools[0].createHandler(strapi, {} as any);
    const result = await handler({ args: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain('boom');
  });

  it('gives each tool a human-readable title', () => {
    const { strapi, captured } = createFakeStrapi();
    registerToolsOnMcp(strapi, registryWith(readTool));
    expect(captured.tools[0].title).toBe('Strapi: Search Content');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- register-tools`
Expected: FAIL — cannot resolve `../../server/src/mcp/register-tools`.

- [ ] **Step 3: Create `server/src/mcp/register-tools.ts`**

```ts
import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolRegistry } from '../lib/tool-registry';
import { toSnakeCase, toTitle } from './naming';
import { actionFor } from './access';
import { guardSize } from './size-guard';

/**
 * `resolveOutputSchema` is required and must be a ZodObject, but these tools
 * return heterogeneous shapes. One permissive schema satisfies the contract
 * for all of them; tightening per tool is possible later.
 */
export const LOOSE_OUTPUT = z.object({}).catchall(z.any());

/**
 * Register every public registry tool on the official Strapi MCP server.
 *
 * Tool schemas are Zod 4 and are handed to `resolveInputSchema` untouched —
 * the MCP SDK detects Zod 4 by duck-typing and converts with its own bundled
 * zod/v4-mini. No conversion layer is needed or wanted; adding one would
 * strip `.describe()` text.
 *
 * Returns the number of tools registered.
 */
export function registerToolsOnMcp(strapi: Core.Strapi, registry: ToolRegistry): number {
  const mcp = strapi.ai!.mcp;
  let count = 0;

  for (const [name, def] of registry.getPublic()) {
    mcp.registerTool({
      name: toSnakeCase(name),
      title: toTitle(name),
      description: def.description,
      resolveInputSchema: () => def.schema as any,
      resolveOutputSchema: () => LOOSE_OUTPUT as any,
      auth: { policies: [{ action: actionFor(def) }] },
      createHandler: (s: Core.Strapi) => async ({ args }: { args?: unknown }) => {
        try {
          const raw = await def.execute(args ?? {}, s);
          const result = guardSize(raw, def.name);

          // structuredContent must be an object because the output schema is
          // a ZodObject. Wrap arrays and scalars so every tool complies.
          const structuredContent =
            result && typeof result === 'object' && !Array.isArray(result)
              ? (result as Record<string, unknown>)
              : { result };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          s.log.error(`[ai-sdk:mcp] Tool ${def.name} failed: ${message}`);
          // Error is a separate branch of the union: isError present,
          // structuredContent absent. Never both.
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message }) }],
            isError: true as const,
          };
        }
      },
    } as any);
    count++;
  }

  return count;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- register-tools`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/register-tools.ts tests/mcp/register-tools.test.ts
git commit -m "feat: register registry tools on the official Strapi MCP server"
```

---

### Task 8: Register the tool guide as an MCP resource

The old server exposed `strapi://tools/guide` through `ListResources`/`ReadResource` handlers. The official API offers `registerResource`, so this ports over.

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/mcp/register-resources.ts`
- Create: `strapi-plugin-ai-sdk/tests/mcp/register-resources.test.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/mcp/resources/tool-guide.ts` (no code change; confirm the export only)

**Interfaces:**
- Consumes: `generateToolGuide(registry: ToolRegistry): string` from `mcp/resources/tool-guide`; `MCP_ACTIONS` from `mcp/access`
- Produces: `TOOL_GUIDE_URI = 'strapi://ai-sdk/tools/guide'`; `registerResourcesOnMcp(strapi: Core.Strapi, registry: ToolRegistry): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/register-resources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import {
  registerResourcesOnMcp,
  TOOL_GUIDE_URI,
} from '../../server/src/mcp/register-resources';

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'searchContent',
    description: 'Search content',
    schema: z.object({ contentType: z.string() }),
    execute: async () => ({}),
    publicSafe: true,
  });
  return registry;
}

describe('registerResourcesOnMcp', () => {
  it('registers the tool guide at a stable URI', () => {
    const { strapi, captured } = createFakeStrapi();
    registerResourcesOnMcp(strapi, buildRegistry());

    expect(captured.resources).toHaveLength(1);
    expect(captured.resources[0].uri).toBe(TOOL_GUIDE_URI);
    expect(captured.resources[0].metadata.mimeType).toBe('text/markdown');
  });

  it('gates the guide behind the read action', () => {
    const { strapi, captured } = createFakeStrapi();
    registerResourcesOnMcp(strapi, buildRegistry());
    expect(captured.resources[0].auth).toEqual({
      policies: [{ action: 'plugin::ai-sdk.mcp.read' }],
    });
  });

  it('returns generated markdown mentioning a registered tool', async () => {
    const { strapi, captured } = createFakeStrapi();
    registerResourcesOnMcp(strapi, buildRegistry());

    const handler = captured.resources[0].createHandler(strapi);
    const result = await handler(new URL(TOOL_GUIDE_URI), {} as any);

    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('searchContent');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- register-resources`
Expected: FAIL — cannot resolve `../../server/src/mcp/register-resources`.

- [ ] **Step 3: Create `server/src/mcp/register-resources.ts`**

```ts
import type { Core } from '@strapi/strapi';
import type { ToolRegistry } from '../lib/tool-registry';
import { generateToolGuide } from './resources/tool-guide';
import { MCP_ACTIONS } from './access';

export const TOOL_GUIDE_URI = 'strapi://ai-sdk/tools/guide';

/**
 * Register static MCP resources.
 *
 * The official server does not let plugins set server-level `instructions`,
 * so the tool guide carries the usage guidance the retired server used to
 * send in its instructions string.
 */
export function registerResourcesOnMcp(strapi: Core.Strapi, registry: ToolRegistry): void {
  strapi.ai!.mcp.registerResource({
    name: 'ai-sdk-tool-guide',
    uri: TOOL_GUIDE_URI,
    metadata: {
      description:
        'Complete guide to all available Strapi AI SDK tools, with parameters and usage examples.',
      mimeType: 'text/markdown',
    },
    auth: { policies: [{ action: MCP_ACTIONS.read }] },
    createHandler: () => async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          // Generated per read so newly discovered plugin tools appear.
          text: generateToolGuide(registry),
        },
      ],
    }),
  } as any);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- register-resources`
Expected: PASS, 3 tests.

If the third test fails because `generateToolGuide` renders MCP names rather than registry names, change the assertion to match what it actually emits — do not change `tool-guide.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/register-resources.ts tests/mcp/register-resources.test.ts
git commit -m "feat: expose the tool guide as an MCP resource"
```

---

### Task 9: Make JSON-string arguments coercible again

The retired server pre-parsed stringified JSON args in `coerceArgs`. The official server validates against the schema *before* the handler runs, so coercion must move into the schemas. `z.preprocess` does this and — verified against the MCP SDK's converter — still emits a clean typed JSON Schema rather than collapsing to `{}`.

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/lib/json-coercible.ts`
- Create: `strapi-plugin-ai-sdk/tests/lib/json-coercible.test.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/tool-logic/search-content.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/tool-logic/find-one-content.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/tool-logic/create-content.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/tool-logic/update-content.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/tool-logic/aggregate-content.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `jsonCoercible<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.infer<T>>`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/json-coercible.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonCoercible } from '../../server/src/lib/json-coercible';

describe('jsonCoercible', () => {
  it('accepts an already-parsed array', () => {
    const schema = jsonCoercible(z.array(z.string()));
    expect(schema.parse(['title', 'slug'])).toEqual(['title', 'slug']);
  });

  it('parses a JSON-encoded array string', () => {
    const schema = jsonCoercible(z.array(z.string()));
    expect(schema.parse('["title","slug"]')).toEqual(['title', 'slug']);
  });

  it('parses a JSON-encoded object string', () => {
    const schema = jsonCoercible(z.record(z.string(), z.unknown()));
    expect(schema.parse('{"title":{"$eq":"hi"}}')).toEqual({ title: { $eq: 'hi' } });
  });

  it('leaves plain strings alone so string branches of a union still work', () => {
    const schema = jsonCoercible(z.union([z.string(), z.array(z.string())]));
    expect(schema.parse('*')).toBe('*');
  });

  it('rejects malformed JSON that looks like JSON', () => {
    const schema = jsonCoercible(z.array(z.string()));
    expect(() => schema.parse('["unterminated')).toThrow();
  });

  it('still emits a typed JSON Schema rather than an untyped blob', () => {
    const wrapped = z.object({ fields: jsonCoercible(z.array(z.string())).optional() });
    const json = z.toJSONSchema(wrapped) as any;
    expect(json.properties.fields.type).toBe('array');
    expect(json.properties.fields.items.type).toBe('string');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- json-coercible`
Expected: FAIL — cannot resolve `../../server/src/lib/json-coercible`.

- [ ] **Step 3: Create `server/src/lib/json-coercible.ts`**

```ts
import { z } from 'zod';

/**
 * Wrap a schema so a JSON-encoded string is parsed before validation.
 *
 * MCP clients — notably via mcp-remote — sometimes send complex arguments as
 * JSON text: `fields: '["title","slug"]'` instead of `fields: ["title"]`. The
 * official server validates arguments before our handler runs, so this must
 * live in the schema itself.
 *
 * `z.preprocess` is deliberate: it coerces at parse time while still emitting
 * the wrapped schema's own JSON Schema, so clients keep seeing a typed
 * parameter. A union would emit `anyOf` and would not coerce.
 *
 * Only strings that look like JSON objects or arrays are touched, so genuine
 * string values (e.g. populate: "*") pass through untouched.
 */
export function jsonCoercible<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Leave it as-is; the wrapped schema produces the validation error.
      return value;
    }
  }, schema) as z.ZodType<z.infer<T>>;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- json-coercible`
Expected: PASS, 6 tests.

- [ ] **Step 5: Apply to `search-content.ts`**

Add the import after the existing `zod` import:

```ts
import { jsonCoercible } from '../lib/json-coercible';
```

Wrap the three complex params in `searchContentSchema`, keeping every `.describe()` exactly as written:

```ts
  filters: jsonCoercible(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Strapi filter object. Scalar: { title: { $containsi: "hello" } }. Relation: { author: { name: { $eq: "John" } } }. ManyToMany: { contentTags: { title: { $eq: "tutorial" } } }. Operators: $eq, $ne, $containsi, $in, $gt, $lt, $gte, $lte, $null, $notNull.'),
  fields: jsonCoercible(z.array(z.string()))
    .optional()
    .describe('Specific fields to return. If omitted, returns all fields (large content fields stripped unless includeContent is true).'),
```

and

```ts
  populate: jsonCoercible(
    z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  )
    .optional()
    .describe('Relations to populate. Defaults to "*" (all). Can be a string, array, or object.'),
```

- [ ] **Step 6: Apply to the remaining four tool-logic files**

Add the same import to each, then wrap:

- `find-one-content.ts` — `populate` (the `z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())])` schema) and `fields` (the `z.array(z.string())` schema)
- `create-content.ts` — `data` (the `z.record(z.string(), z.unknown())` schema)
- `update-content.ts` — `data` (the `z.record(z.string(), z.unknown())` schema)
- `aggregate-content.ts` — `filters` (the `z.record(z.string(), z.unknown())` schema)

In every case wrap only the inner type and leave `.optional()`, `.default()`, and `.describe()` chained after `jsonCoercible(...)` exactly as they are now. `upload-media.ts`, `send-email.ts`, and `list-content-types.ts` take only scalars and need no change.

- [ ] **Step 7: Type-check and run the full unit suite**

```bash
npm run test:ts:back
npm run test:unit
```

Expected: no type errors; all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/lib/json-coercible.ts tests/lib/json-coercible.test.ts server/src/tool-logic/
git commit -m "feat: coerce JSON-string args in schemas, replacing coerceArgs"
```

---

### Task 10: Wire in the bridge and delete the hand-rolled MCP stack

The cutover. Everything above is additive; this task removes the old server and connects the new one.

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/mcp/index.ts` (replacing the current one-line re-export)
- Modify: `strapi-plugin-ai-sdk/server/src/bootstrap.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/destroy.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/lib/types.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/controllers/index.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/routes/content-api/index.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/config/index.ts`
- Modify: `strapi-plugin-ai-sdk/package.json`
- Delete: `strapi-plugin-ai-sdk/server/src/mcp/server.ts`
- Delete: `strapi-plugin-ai-sdk/server/src/controllers/mcp.ts`
- Delete: `strapi-plugin-ai-sdk/tests/mcp.test.ts`
- Create: `strapi-plugin-ai-sdk/tests/mcp/index.test.ts`

**Interfaces:**
- Consumes: `registerToolsOnMcp` from `mcp/register-tools`; `registerResourcesOnMcp` from `mcp/register-resources`; `registerMcpAdminPermissions` from `mcp/permissions`
- Produces: `registerAiSdkMcpTools(strapi: Core.Strapi, registry: ToolRegistry): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import { registerAiSdkMcpTools } from '../../server/src/mcp';

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'searchContent',
    description: 'Search content',
    schema: z.object({ contentType: z.string() }),
    execute: async () => ({}),
    publicSafe: true,
  });
  return registry;
}

describe('registerAiSdkMcpTools', () => {
  it('registers permissions, tools, and resources when MCP is enabled', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerAiSdkMcpTools(strapi, buildRegistry());

    expect(captured.actions).toHaveLength(3);
    expect(captured.tools).toHaveLength(1);
    expect(captured.resources).toHaveLength(1);
  });

  it('is a no-op when the MCP server is disabled', async () => {
    const { strapi, captured } = createFakeStrapi({ mcpEnabled: false });
    await registerAiSdkMcpTools(strapi, buildRegistry());

    expect(captured.actions).toHaveLength(0);
    expect(captured.tools).toHaveLength(0);
    expect(captured.resources).toHaveLength(0);
  });

  it('does not throw on Strapi versions without the ai namespace', async () => {
    const { strapi, captured } = createFakeStrapi({ hasAiNamespace: false });
    await expect(registerAiSdkMcpTools(strapi, buildRegistry())).resolves.toBeUndefined();
    expect(captured.tools).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- mcp/index`
Expected: FAIL — `registerAiSdkMcpTools` is not exported from `server/src/mcp`.

- [ ] **Step 3: Replace `server/src/mcp/index.ts`**

Overwrite the file entirely:

```ts
// Entry point for registering this plugin's tools on the OFFICIAL Strapi MCP
// server. Called from bootstrap() after plugin tool discovery, so contributed
// tools are already in the registry. Registration must happen before the MCP
// server starts — it locks its capability set at start.
import type { Core } from '@strapi/strapi';
import type { ToolRegistry } from '../lib/tool-registry';
import { registerMcpAdminPermissions } from './permissions';
import { registerToolsOnMcp } from './register-tools';
import { registerResourcesOnMcp } from './register-resources';

export async function registerAiSdkMcpTools(
  strapi: Core.Strapi,
  registry: ToolRegistry,
): Promise<void> {
  const mcp = strapi.ai?.mcp;

  // strapi.ai is absent below 5.47; isEnabled() is false when the host has
  // not set `mcp: { enabled: true }` in config/server.ts.
  if (!mcp?.isEnabled()) {
    strapi.log.info(
      '[ai-sdk:mcp] Official MCP server not enabled — skipping tool registration. ' +
        'Requires Strapi >= 5.47 and `mcp: { enabled: true }` in config/server.ts.',
    );
    return;
  }

  await registerMcpAdminPermissions(strapi);
  const count = registerToolsOnMcp(strapi, registry);
  registerResourcesOnMcp(strapi, registry);

  strapi.log.info(`[ai-sdk:mcp] Registered ${count} tool(s) on the official MCP server.`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- mcp/index`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire into `bootstrap.ts`**

Replace the import of the old server:

```ts
import { createMcpServer } from './mcp/server';
```

with:

```ts
import { registerAiSdkMcpTools } from './mcp';
```

Then replace the body of `bootstrap` so the three MCP lines at the end become the new call. The function becomes `async`:

```ts
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = strapi.plugin(PLUGIN_ID) as unknown as PluginInstance;
  const config = strapi.config.get<PluginConfig>(`plugin::${PLUGIN_ID}`);

  initializeProvider(strapi, plugin, config);
  const registry = initializeToolRegistry(plugin);
  discoverPluginTools(strapi, registry);

  await registerAiSdkMcpTools(strapi, registry);
};
```

The three deleted lines are `plugin.createMcpServer = ...`, `plugin.mcpSessions = new Map()`, and the `MCP endpoint available at` log.

- [ ] **Step 6: Delete the old server, controller, and test**

```bash
git rm server/src/mcp/server.ts server/src/controllers/mcp.ts tests/mcp.test.ts
```

- [ ] **Step 7: Remove the MCP controller registration**

In `server/src/controllers/index.ts`, delete the `import mcp from './mcp';` line and the `mcp,` entry in the default export.

- [ ] **Step 8: Remove the MCP routes**

In `server/src/routes/content-api/index.ts`, delete the three route objects whose `handler` is `'mcp.handle'` (the `POST /mcp`, `GET /mcp`, and `DELETE /mcp` entries). Leave `/ask`, `/ask-stream`, `/chat`, `/public-chat`, and `/widget.js` untouched.

- [ ] **Step 9: Remove MCP session types**

In `server/src/lib/types.ts`, delete the two `@modelcontextprotocol/sdk` imports at lines 2–3, the whole `export interface MCPSession { ... }` block, and the `createMcpServer` and `mcpSessions` fields from `PluginInstance`.

- [ ] **Step 10: Simplify `destroy.ts`**

Overwrite the file:

```ts
import type { Core } from '@strapi/strapi';
import type { PluginInstance } from './lib/types';

const PLUGIN_ID = 'ai-sdk';

const destroy = async ({ strapi }: { strapi: Core.Strapi }) => {
  try {
    const plugin = strapi.plugin(PLUGIN_ID) as unknown as PluginInstance;

    if (plugin.aiProvider) {
      plugin.aiProvider.destroy();
      plugin.aiProvider = undefined;
    }
  } catch (error) {
    strapi.log.error(`[${PLUGIN_ID}] Error during cleanup`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export default destroy;
```

Session teardown is gone because Strapi owns the transport now.

- [ ] **Step 11: Remove the MCP config block**

In `server/src/config/index.ts`, delete the `mcp: { sessionTimeoutMs, maxSessions, cleanupInterval }` block from `default`. Leave `guardrails` and `publicChat` untouched.

- [ ] **Step 12: Drop the runtime MCP SDK dependency**

In `package.json`, remove `"@modelcontextprotocol/sdk": "^1.26.0"` from `dependencies`, and remove the `"@modelcontextprotocol/sdk"` entry from `bundleDependencies`. Then:

```bash
npm install
```

- [ ] **Step 13: Verify nothing still references the deleted code**

```bash
grep -rn "createMcpServer\|mcpSessions\|MCPSession\|modelcontextprotocol" server/src/ || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 14: Type-check and run everything**

```bash
npm run test:ts:back
npm run test:ts:front
npm run test:unit
```

Expected: no type errors; all unit tests pass.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor!: replace hand-rolled MCP server with official Strapi MCP

Deletes mcp/server.ts, controllers/mcp.ts, the three /mcp routes, the mcp
session config, and the runtime @modelcontextprotocol/sdk dependency.
Tools now register on strapi.ai.mcp during bootstrap.

BREAKING CHANGE: the MCP endpoint moves from /api/ai-sdk/mcp to /mcp and
is authenticated with Admin API tokens. Requires Strapi >= 5.47 with
mcp: { enabled: true } in config/server.ts."
```

---

### Task 11: Warn on incompatible plugin versions

With ai-sdk now a hard requirement for the extension plugins, a version mismatch should say so plainly rather than fail later at registration.

**Files:**
- Create: `strapi-plugin-ai-sdk/server/src/lib/check-compat.ts`
- Create: `strapi-plugin-ai-sdk/tests/lib/check-compat.test.ts`
- Modify: `strapi-plugin-ai-sdk/server/src/bootstrap.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `checkPluginCompat(strapi: Core.Strapi, pluginName: string, declaredRange: string | undefined, ownVersion: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/check-compat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { checkPluginCompat } from '../../server/src/lib/check-compat';

describe('checkPluginCompat', () => {
  it('accepts a satisfied caret range', () => {
    const { strapi, captured } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'yt-transcripts', '^1.1.0', '1.1.0')).toBe(true);
    expect(captured.logs.filter((l) => l.level === 'warn')).toHaveLength(0);
  });

  it('accepts a higher patch within the same major', () => {
    const { strapi } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'yt-transcripts', '^1.1.0', '1.4.2')).toBe(true);
  });

  it('warns when the running major is too low', () => {
    const { strapi, captured } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'yt-embeddings', '^2.0.0', '1.1.0')).toBe(false);

    const warning = captured.logs.find((l) => l.level === 'warn');
    expect(warning?.message).toContain('yt-embeddings');
    expect(warning?.message).toContain('^2.0.0');
    expect(warning?.message).toContain('1.1.0');
  });

  it('accepts a >= range that is satisfied', () => {
    const { strapi } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'legacy', '>=0.7.0', '1.1.0')).toBe(true);
  });

  it('treats a missing declaration as compatible without warning', () => {
    const { strapi, captured } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'other', undefined, '1.1.0')).toBe(true);
    expect(captured.logs.filter((l) => l.level === 'warn')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- check-compat`
Expected: FAIL — cannot resolve `../../server/src/lib/check-compat`.

- [ ] **Step 3: Create `server/src/lib/check-compat.ts`**

```ts
import type { Core } from '@strapi/strapi';

/** Parse "1.2.3" into [1, 2, 3]; returns null when unparseable. */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Minimal range check covering the forms plugin authors actually write:
 * "^1.1.0", ">=0.7.0", and exact "1.1.0". Deliberately not a full semver
 * implementation — this is a diagnostic, not a gate, and we do not want a
 * dependency for it.
 */
function satisfies(version: string, range: string): boolean {
  const actual = parseVersion(version);
  if (!actual) return true;

  const trimmed = range.trim();
  const caret = trimmed.startsWith('^');
  const gte = trimmed.startsWith('>=');
  const required = parseVersion(trimmed.replace(/^[\^>=~\s]+/, ''));
  if (!required) return true;

  const [aMajor, aMinor, aPatch] = actual;
  const [rMajor, rMinor, rPatch] = required;

  const atLeast =
    aMajor > rMajor ||
    (aMajor === rMajor && aMinor > rMinor) ||
    (aMajor === rMajor && aMinor === rMinor && aPatch >= rPatch);

  if (caret) return aMajor === rMajor && atLeast;
  if (gte) return atLeast;
  return aMajor === rMajor && aMinor === rMinor && aPatch === rPatch;
}

/**
 * Verify a contributing plugin's declared strapi-plugin-ai-sdk range against
 * the running version. Logs a clear warning on mismatch and returns false;
 * tool discovery continues either way, since a warning at startup beats an
 * opaque failure at registration time.
 */
export function checkPluginCompat(
  strapi: Core.Strapi,
  pluginName: string,
  declaredRange: string | undefined,
  ownVersion: string,
): boolean {
  if (!declaredRange) return true;
  if (satisfies(ownVersion, declaredRange)) return true;

  strapi.log.warn(
    `[ai-sdk] Plugin "${pluginName}" requires strapi-plugin-ai-sdk ${declaredRange} ` +
      `but ${ownVersion} is installed. Its tools may not register correctly — ` +
      `upgrade one of the two packages.`,
  );
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- check-compat`
Expected: PASS, 5 tests.

- [ ] **Step 5: Call it from tool discovery**

In `server/src/bootstrap.ts`, add the import:

```ts
import { checkPluginCompat } from './lib/check-compat';
```

Inside `discoverPluginTools`, immediately after the `strapi.log.info(...Found ai-tools service...)` line, add:

```ts
      // Diagnostic only — a mismatch warns but does not block registration.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ownVersion = require('../../package.json').version as string;
        const declared = (pluginInstance as any)?.package?.peerDependencies?.[
          'strapi-plugin-ai-sdk'
        ];
        checkPluginCompat(strapi, pluginName, declared, ownVersion);
      } catch {
        // Version metadata is not always reachable; never block discovery.
      }
```

- [ ] **Step 6: Type-check and run the suite**

```bash
npm run test:ts:back
npm run test:unit
```

Expected: no type errors; all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/lib/check-compat.ts tests/lib/check-compat.test.ts server/src/bootstrap.ts
git commit -m "feat: warn when a contributing plugin declares an incompatible ai-sdk range"
```

---

## Phase 2 — End-to-end verification

> **Blocked on external prerequisites.** Before starting Task 12, `strapi-local`
> must be on Strapi >= 5.47, have `mcp: { enabled: true }` in
> `config/server.ts`, and have an admin API token minted
> (Settings → Administration Panel → API Tokens). These are the maintainer's to
> perform — do not edit anything under `strapi-local`. Tasks 1–11 do not depend
> on this.
>
> **The tier 1 token must grant all three `plugin::ai-sdk.mcp.*` permissions**
> (read, write, destructive) — a full-access admin token does. Tools are hidden
> from `tools/list` when the token lacks their action, so a scoped token would
> make the exposure assertions fail for the wrong reason. The optional
> `STRAPI_READONLY_TOKEN` is a *second*, deliberately narrow token.

### Task 12: E2E harness and tier 1 structural tests

**Files:**
- Create: `strapi-plugin-ai-sdk/vitest.e2e.config.ts`
- Create: `strapi-plugin-ai-sdk/tests/e2e/client.ts`
- Create: `strapi-plugin-ai-sdk/tests/e2e/structural.test.ts`
- Modify: `strapi-plugin-ai-sdk/package.json`

**Interfaces:**
- Consumes: a running Strapi at `STRAPI_URL` with `STRAPI_ADMIN_TOKEN`
- Produces: `connect(): Promise<Client>`; `EXPECTED_BUILTIN_TOOLS: string[]`

- [ ] **Step 1: Add the MCP SDK back as a dev dependency**

```bash
npm install --save-dev @modelcontextprotocol/sdk@^1.26.0
```

It is dev-only now — used solely by the E2E client, never by plugin runtime code.

- [ ] **Step 2: Create `vitest.e2e.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // The live pipeline mutates shared state; never run those files in parallel.
    fileParallelism: false,
  },
});
```

- [ ] **Step 3: Add the E2E scripts**

In `package.json` `"scripts"`:

```json
    "test:e2e": "vitest run --config vitest.e2e.config.ts tests/e2e/structural.test.ts",
    "test:e2e:live": "E2E_LIVE=1 vitest run --config vitest.e2e.config.ts",
```

- [ ] **Step 4: Create the E2E client helper**

Create `tests/e2e/client.ts`:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const TOKEN = process.env.STRAPI_ADMIN_TOKEN;

/** The built-in tools that reach MCP (internal: true tools are excluded). */
export const EXPECTED_BUILTIN_TOOLS = [
  'aggregate_content',
  'create_content',
  'find_one_content',
  'list_content_types',
  'search_content',
  'send_email',
  'update_content',
  'upload_media',
];

/**
 * Connect an MCP client to the official Strapi endpoint. Admin API tokens
 * authenticate here — Content API tokens will not work.
 */
export async function connect(token: string | undefined = TOKEN): Promise<Client> {
  if (!token) {
    throw new Error(
      'STRAPI_ADMIN_TOKEN is not set. Mint one in Settings > API Tokens (Admin) ' +
        'and export it before running the E2E suite.',
    );
  }

  const transport = new StreamableHTTPClientTransport(new URL(`${STRAPI_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  const client = new Client({ name: 'ai-sdk-e2e', version: '1.1.0' });
  await client.connect(transport);
  return client;
}

/** Fetch the tool list as a name -> tool map. */
export async function toolMap(client: Client): Promise<Record<string, any>> {
  const { tools } = await client.listTools();
  return Object.fromEntries(tools.map((t: any) => [t.name, t]));
}
```

- [ ] **Step 5: Write the tier 1 structural tests**

Create `tests/e2e/structural.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connect, toolMap, EXPECTED_BUILTIN_TOOLS } from './client';

let client: Client;
let tools: Record<string, any>;

beforeAll(async () => {
  client = await connect();
  tools = await toolMap(client);
});

afterAll(async () => {
  await client?.close();
});

describe('tool exposure', () => {
  it('exposes every built-in tool that is not internal', () => {
    for (const name of EXPECTED_BUILTIN_TOOLS) {
      expect(tools, `missing built-in tool ${name}`).toHaveProperty(name);
    }
  });

  it('does not expose internal chat-only tools', () => {
    for (const name of ['save_memory', 'recall_memories', 'save_note', 'manage_task']) {
      expect(tools).not.toHaveProperty(name);
    }
  });

  it('exposes the yt-transcripts tools under its namespace', () => {
    const names = Object.keys(tools).filter((n) => n.startsWith('ai_sdk_yt_transcripts__'));
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it('exposes the yt-embeddings tools under its namespace', () => {
    const names = Object.keys(tools).filter((n) => n.startsWith('ai_sdk_yt_embeddings__'));
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it('registers no duplicate tool names', async () => {
    const { tools: list } = await client.listTools();
    const names = list.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('schema fidelity', () => {
  it('preserves .describe() text on tool parameters', () => {
    // The regression test for the Zod 4 pass-through. If a conversion layer
    // is ever reintroduced, or `z` is imported from @strapi/utils, these
    // descriptions vanish and the model loses all parameter guidance.
    const contentType = tools.search_content.inputSchema.properties.contentType;
    expect(contentType.description).toBeTruthy();
    expect(contentType.description).toContain('api::article.article');
  });

  it('keeps complex parameters typed despite JSON-string coercion', () => {
    const fields = tools.search_content.inputSchema.properties.fields;
    expect(fields.type).toBe('array');
    expect(fields.items.type).toBe('string');
  });

  it('gives every tool a non-empty description', () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description, `${name} has no description`).toBeTruthy();
    }
  });
});

describe('resources', () => {
  it('serves the tool guide as markdown', async () => {
    const { resources } = await client.listResources();
    const guide = resources.find((r: any) => r.uri === 'strapi://ai-sdk/tools/guide');
    expect(guide).toBeDefined();

    const read = await client.readResource({ uri: 'strapi://ai-sdk/tools/guide' });
    expect(read.contents[0].mimeType).toBe('text/markdown');
    expect(String(read.contents[0].text).length).toBeGreaterThan(100);
  });
});

describe('cross-plugin wiring', () => {
  it('reaches the transcript content type the embeddings hook depends on', async () => {
    // yt-embeddings subscribes to this exact UID in its bootstrap. If
    // yt-transcripts ever renames it, that hook silently stops firing.
    const result: any = await client.callTool({
      name: 'list_content_types',
      arguments: {},
    });
    expect(JSON.stringify(result.structuredContent)).toContain(
      'plugin::ai-sdk-yt-transcripts.transcript',
    );
  });

  it('reports all three tool sources with their getMeta labels', async () => {
    // The admin /tool-sources endpoint backs the chat UI's source dropdown.
    // It reads the same registry MCP does, so a discovery regression shows
    // up here even when MCP itself looks fine.
    const response = await fetch(`${STRAPI_URL}/ai-sdk/tool-sources`, {
      headers: { Authorization: `Bearer ${process.env.STRAPI_ADMIN_TOKEN}` },
    });
    expect(response.ok).toBe(true);

    const { data } = (await response.json()) as { data: { id: string; toolCount: number }[] };
    const ids = data.map((s) => s.id);

    expect(ids).toContain('built-in');
    expect(ids).toContain('ai_sdk_yt_transcripts');
    expect(ids).toContain('ai_sdk_yt_embeddings');

    for (const source of data) {
      expect(source.toolCount).toBeGreaterThan(0);
    }
  });
});
```

Note the `STRAPI_URL` import — update the import line at the top of the file to:

```ts
import { connect, toolMap, EXPECTED_BUILTIN_TOOLS, STRAPI_URL } from './client';
```

If `/ai-sdk/tool-sources` 404s, the admin route prefix differs in your setup;
find it with `grep -rn "tool-sources" server/src/routes/` and adjust the path.

- [ ] **Step 6: Run tier 1 against strapi-local**

Start strapi-local in another terminal, then:

```bash
export STRAPI_URL=http://localhost:1337
export STRAPI_ADMIN_TOKEN=<the admin token>
npm run test:e2e
```

Expected: PASS. Investigate every failure — these are the assertions the whole migration exists to satisfy. If `search_content`'s `contentType` description assertion fails, confirm no conversion layer was reintroduced and that `zod` is imported from `'zod'`.

- [ ] **Step 7: Add the permission-scoping test**

Append this block to `tests/e2e/structural.test.ts`. It self-skips unless a
second, deliberately narrow token is supplied, so the suite stays runnable with
one token:

```ts
describe('permission scoping', () => {
  it('hides write and destructive tools from a read-only token', async () => {
    const readOnly = process.env.STRAPI_READONLY_TOKEN;
    if (!readOnly) return; // skipped unless a scoped token is provided

    const scoped = await connect(readOnly);
    const scopedTools = await toolMap(scoped);

    expect(scopedTools).toHaveProperty('search_content');
    expect(scopedTools).not.toHaveProperty('create_content');
    expect(scopedTools).not.toHaveProperty('send_email');

    await scoped.close();
  });
});
```

To exercise it, create a second admin role granting only **Use read-only AI SDK
MCP tools**, mint a token for it, then:

```bash
STRAPI_READONLY_TOKEN=<read-only token> npm run test:e2e
```

Expected: the scoping test runs and passes. Without the variable it is skipped.

- [ ] **Step 8: Confirm the chat regression net is still green**

```bash
npm run test:api
npm run test:chat
npm run test:guardrails
```

Expected: PASS, unmodified. These prove swapping the MCP layer left the chat paths untouched.

- [ ] **Step 9: Commit**

```bash
git add vitest.e2e.config.ts tests/e2e/ package.json package-lock.json
git commit -m "test: add tier 1 structural E2E suite for the three plugins"
```

---

### Task 13: Tier 2 live pipeline test

Exercises the real chain: transcript fetch → lifecycle hook → embeddings → semantic search over MCP.

**Files:**
- Create: `strapi-plugin-ai-sdk/tests/e2e/pipeline.live.test.ts`

**Interfaces:**
- Consumes: `connect`, `toolMap` from `tests/e2e/client`
- Produces: nothing

- [ ] **Step 1: Write the live pipeline test**

Create `tests/e2e/pipeline.live.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connect, toolMap } from './client';

// A short, stable, captioned video. Swap if it ever goes private.
const VIDEO_ID = 'dQw4w9WgXcQ';

const live = process.env.E2E_LIVE === '1';

let client: Client;
let tools: Record<string, any>;

/** Poll until `check` returns true or the budget runs out. */
async function waitFor(
  check: () => Promise<boolean>,
  { timeoutMs = 90_000, intervalMs = 3_000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function toolNamed(prefix: string, suffix: string): string {
  const match = Object.keys(tools).find((n) => n.startsWith(prefix) && n.endsWith(suffix));
  if (!match) throw new Error(`No tool matching ${prefix}*${suffix}. Have: ${Object.keys(tools)}`);
  return match;
}

describe.skipIf(!live)('live transcript to embeddings pipeline', () => {
  beforeAll(async () => {
    client = await connect();
    tools = await toolMap(client);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('fetches a transcript through the yt-transcripts tool', async () => {
    const result: any = await client.callTool({
      name: toolNamed('ai_sdk_yt_transcripts__', 'fetch_transcript'),
      arguments: { videoId: VIDEO_ID },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.structuredContent)).toContain(VIDEO_ID);
  });

  it('lists the stored transcript', async () => {
    const found = await waitFor(async () => {
      const result: any = await client.callTool({
        name: toolNamed('ai_sdk_yt_transcripts__', 'list_transcripts'),
        arguments: {},
      });
      return JSON.stringify(result.structuredContent).includes(VIDEO_ID);
    });

    expect(found, 'transcript never appeared in list_transcripts').toBe(true);
  });

  it('auto-embeds the transcript via the yt-embeddings lifecycle hook', async () => {
    // The hook subscribes to plugin::ai-sdk-yt-transcripts.transcript. This is
    // the assertion that proves the two plugins are actually wired together.
    const embedded = await waitFor(async () => {
      const result: any = await client.callTool({
        name: toolNamed('ai_sdk_yt_embeddings__', 'list_yt_videos'),
        arguments: {},
      });
      return JSON.stringify(result.structuredContent).includes(VIDEO_ID);
    });

    expect(embedded, 'transcript was never embedded — is the lifecycle hook firing?').toBe(true);
  });

  it('finds the content through semantic search', async () => {
    const result: any = await client.callTool({
      name: toolNamed('ai_sdk_yt_embeddings__', 'search_yt_knowledge'),
      arguments: { query: 'never gonna give you up', limit: 5 },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.structuredContent)).toContain(VIDEO_ID);
  });

  it('keeps every result under the MCP wire limit', async () => {
    const result: any = await client.callTool({
      name: toolNamed('ai_sdk_yt_transcripts__', 'get_transcript'),
      arguments: { videoId: VIDEO_ID },
    });

    const wireBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    expect(wireBytes).toBeLessThan(1_000_000);
  });
});
```

- [ ] **Step 2: Run the live suite**

```bash
export STRAPI_URL=http://localhost:1337
export STRAPI_ADMIN_TOKEN=<the admin token>
npm run test:e2e:live
```

Expected: PASS. The embedding step is the slow one; the poll allows 90 seconds.

If the embedding assertion fails, check strapi-local's logs for
`YouTube transcript lifecycle hook registered` at boot — its absence means
yt-embeddings did not find the transcripts plugin.

- [ ] **Step 3: Clean up the test data**

The video now has a transcript and embeddings in strapi-local. Remove them through the admin UI (Content Manager → Transcript) so reruns start clean, or leave them — the test is written to be idempotent.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/pipeline.live.test.ts
git commit -m "test: add tier 2 live pipeline E2E test"
```

---

### Task 14: Documentation

**Files:**
- Create: `strapi-plugin-ai-sdk/docs/plugin-contract.md`
- Modify: `strapi-plugin-ai-sdk/README.md`
- Modify: `strapi-plugin-ai-sdk/docs/architecture.md`
- Modify: `strapi-plugin-ai-sdk/docs/mcp-consolidation.md`
- Modify: `strapi-plugin-ai-sdk/docs/tool-standardization-spec.md`
- Modify: `strapi-plugin-ai-sdk-yt-embeddings/README.md`
- Modify: `strapi-plugin-ai-sdk-yt-transcripts/README.md`

**Interfaces:**
- Consumes: everything built above
- Produces: no code

- [ ] **Step 1: Write the contract doc**

Create `docs/plugin-contract.md` covering, with real code examples drawn from the implementation:

1. The `ai-tools` service contract — `getTools()` and optional `getMeta()`, with the shape returned by both.
2. The `ToolDefinition` interface including `internal`, `publicSafe`, and the new `access` field, and how `access` defaults.
3. Namespacing — `<safePluginName>__<toolName>` in the registry, converted to snake_case for MCP.
4. The three MCP permission tiers and their action ids.
5. **Zod rules:** use the package's own `zod` (v4); never import `z` from `@strapi/utils`, because descriptions are silently dropped in conversion. Wrap array/object params in `jsonCoercible()`.
6. The `plugin::ai-sdk-yt-transcripts.transcript` model UID coupling, marked as a breaking-change hazard for yt-transcripts.
7. Requirements: Strapi >= 5.47 and `mcp: { enabled: true }`.

- [ ] **Step 2: Update the README**

In `strapi-plugin-ai-sdk/README.md`, rewrite the MCP section to state:

- The endpoint is now `/mcp` (Strapi's own), not `/api/ai-sdk/mcp`
- Requires Strapi >= 5.47 and `mcp: { enabled: true }` in `config/server.ts`
- Authentication uses **Admin** API tokens, not Content API tokens
- A role must grant the relevant `plugin::ai-sdk.mcp.*` permissions for tools to appear
- A client config example using the new URL and an admin token
- A **Migrating from 0.x** subsection covering the endpoint change, the auth change, and the loss of stringified-argument tolerance for any param not wrapped in `jsonCoercible`

- [ ] **Step 3: Update architecture.md**

Replace any description of the hand-rolled MCP server, sessions, or transport with the bridge model: registry → `registerAiSdkMcpTools` → `strapi.ai.mcp`. Keep the chat-path sections as they are; they did not change.

- [ ] **Step 4: Add pointers to the superseded docs**

At the top of both `docs/mcp-consolidation.md` and `docs/tool-standardization-spec.md`, add:

```markdown
> **Superseded in part by [plugin-contract.md](./plugin-contract.md)** as of
> v1.1.0, which is the source of truth for the tool contract, namespacing,
> Zod rules, and MCP permission tiers. This document is retained for its
> historical rationale.
```

In `mcp-consolidation.md`, also correct the "Remove: ... `@modelcontextprotocol/sdk` dependency" migration guidance — it is now accurate for ai-sdk itself too.

- [ ] **Step 5: Update both extension plugin READMEs**

In each, note the new requirements: Strapi >= 5.47, `strapi-plugin-ai-sdk` ^1.1.0, and that their tools are reached through Strapi's `/mcp` endpoint with an admin token that grants `plugin::ai-sdk.mcp.read`.

- [ ] **Step 6: Commit in all three repos**

```bash
cd /Users/paul/work/plugin-dev/ai-sdk-plugins/strapi-plugin-ai-sdk
git add docs/ README.md
git commit -m "docs: document the plugin contract and the official MCP migration"

cd ../strapi-plugin-ai-sdk-yt-embeddings
git add README.md
git commit -m "docs: note Strapi 5.47 and ai-sdk 1.1.0 requirements"

cd ../strapi-plugin-ai-sdk-yt-transcripts
git add README.md
git commit -m "docs: note Strapi 5.47 and ai-sdk 1.1.0 requirements"
```

---

## Done

Each of the three repos has a `feat/official-strapi-mcp-migration` branch with its changes and version `1.1.0`. Publishing to npm and any host-app rollout are explicitly out of scope.
