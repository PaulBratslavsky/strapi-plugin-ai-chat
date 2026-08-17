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
