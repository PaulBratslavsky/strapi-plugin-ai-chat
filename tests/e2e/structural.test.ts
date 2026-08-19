/**
 * Tier 1 structural E2E suite.
 *
 * Requires a running Strapi host (>= 5.47) with `mcp: { enabled: true }` and
 * an admin API token exported as STRAPI_ADMIN_TOKEN. The token must grant all
 * individual `plugin::<owner>.tool.<slug>` permissions (one per tool,
 * maintenance) — the `EXPECTED_BUILTIN_TOOLS` list below includes
 * `send_email`, which lives in the `destructive` tier, and the
 * yt-transcripts/yt-embeddings namespace counts below depend on
 * `fetchTranscript` and `searchYtKnowledge`, which live in the `maintenance`
 * tier. Permission gating filters what `tools/list` returns, so a token
 * missing any one of the four tiers will fail the tool-exposure assertions
 * below for the wrong reason (looks like a missing tool, is actually a
 * missing permission).
 *
 * See tests/e2e/client.ts for the connect() helper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connect, toolMap, EXPECTED_BUILTIN_TOOLS, STRAPI_URL } from './client';

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
    // All 6 tools marked `internal: true` in server/src/tools/definitions/:
    // save-memory, recall-memories, recall-public-memories, manage-task,
    // save-note, recall-notes. Checking all six (not a subset) catches a
    // leak of e.g. recall_public_memories or recall_notes onto MCP that a
    // partial list would miss.
    for (const name of [
      'save_memory',
      'recall_memories',
      'recall_public_memories',
      'manage_task',
      'save_note',
      'recall_notes',
    ]) {
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
    // The SDK types contents[0] as a text-or-blob union; this resource is
    // always text/markdown, so narrow it explicitly rather than widen the
    // resource type just for the test.
    const content = read.contents[0] as { text: string; mimeType?: string };
    expect(content.mimeType).toBe('text/markdown');
    expect(String(content.text).length).toBeGreaterThan(100);
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
    //
    // NOTE on the hyphen/underscore split below — this looks inconsistent
    // but is correct, do not "fix" it:
    //   - Tool-SOURCE ids (this endpoint) come from bootstrap.ts's
    //     `safeName = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_')`. Hyphens
    //     are inside that allowed character class, so plugin names like
    //     `ai-sdk-yt-transcripts` survive with hyphens intact.
    //   - MCP tool NAMES (asserted elsewhere in this file, e.g.
    //     `ai_sdk_yt_transcripts__...`) go through `toSnakeCase()`, which
    //     explicitly converts hyphens to underscores.
    // Source ids = hyphens. Tool names = underscores.
    const response = await fetch(`${STRAPI_URL}/ai-sdk/tool-sources`, {
      headers: { Authorization: `Bearer ${process.env.STRAPI_ADMIN_TOKEN}` },
    });
    expect(response.ok).toBe(true);

    const { data } = (await response.json()) as { data: { id: string; toolCount: number }[] };
    const ids = data.map((s) => s.id);

    expect(ids).toContain('built-in');
    expect(ids).toContain('ai-sdk-yt-transcripts');
    expect(ids).toContain('ai-sdk-yt-embeddings');

    for (const source of data) {
      expect(source.toolCount).toBeGreaterThan(0);
    }
  });
});

describe('permission scoping', () => {
  it.skipIf(!process.env.STRAPI_READONLY_TOKEN)(
    'hides write, destructive, and maintenance tools from a read-only token',
    async () => {
      const readOnly = process.env.STRAPI_READONLY_TOKEN!;

      const scoped = await connect(readOnly);
      const scopedTools = await toolMap(scoped);

      expect(scopedTools).toHaveProperty('search_content');
      expect(scopedTools).not.toHaveProperty('create_content');
      expect(scopedTools).not.toHaveProperty('send_email');
      // fetchTranscript and searchYtKnowledge moved from write/read into the
      // maintenance tier — a read-only token must not see them either.
      expect(scopedTools).not.toHaveProperty('ai_sdk_yt_transcripts__fetch_transcript');
      expect(scopedTools).not.toHaveProperty('ai_sdk_yt_embeddings__search_yt_knowledge');

      await scoped.close();
    },
  );
});
