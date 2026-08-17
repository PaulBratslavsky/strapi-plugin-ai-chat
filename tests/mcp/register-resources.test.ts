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
    // generateToolGuide renders MCP-style snake_case names, not registry camelCase names.
    expect(result.contents[0].text).toContain('search_content');
  });
});
