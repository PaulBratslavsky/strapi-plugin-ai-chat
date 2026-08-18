import { describe, it, expect } from 'vitest';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { registerMcpAdminPermissions, MCP_ACTION_DEFS } from '../../server/src/mcp/permissions';
import { MCP_ACTIONS } from '../../server/src/mcp/access';

describe('registerMcpAdminPermissions', () => {
  it('registers one action per tier', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi);
    expect(captured.actions).toHaveLength(4);
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
    expect(MCP_ACTION_DEFS).toHaveLength(4);
  });
});
