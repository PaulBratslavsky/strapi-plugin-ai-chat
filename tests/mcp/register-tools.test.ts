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
      policies: [{ action: 'plugin::ai-chat.tool.search-content' }],
    });
    expect(byName.create_content.auth).toEqual({
      policies: [{ action: 'plugin::ai-chat.tool.create-content' }],
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

  it('skips a tool that fails to register and continues with the rest', () => {
    // create_content is writeTool's derived MCP name — simulate the official
    // server's capability registry rejecting it (e.g. a duplicate name
    // collision with a content-manager-derived tool).
    const { strapi, captured } = createFakeStrapi({ failToolNames: ['create_content'] });
    const toolA = {
      name: 'toolA',
      description: 'A',
      schema: z.object({}),
      execute: async () => ({}),
      publicSafe: true,
    };
    const toolC = {
      name: 'toolC',
      description: 'C',
      schema: z.object({}),
      execute: async () => ({}),
      publicSafe: true,
    };

    const count = registerToolsOnMcp(strapi, registryWith(toolA, writeTool, toolC));

    expect(count).toBe(2);
    expect(captured.tools.map((t) => t.name).sort()).toEqual(['tool_a', 'tool_c']);

    const warning = captured.logs.find(
      (l) => l.level === 'warn' && l.message.includes('createContent'),
    );
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('create_content');
    expect(warning?.message).toContain('already registered');
  });
});
