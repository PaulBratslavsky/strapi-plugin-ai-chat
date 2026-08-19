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
