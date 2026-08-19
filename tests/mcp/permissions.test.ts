import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import {
  registerMcpAdminPermissions,
  buildMcpActionDefs,
  actionForTool,
  TOOL_GUIDE_ACTION,
} from '../../server/src/mcp/permissions';

// Strapi's admin action uid validator (@strapi/admin
// validation/action-provider.ts): only lowercase letters, dots, and
// hyphens — no underscores. A uid built from the MCP snake_case tool name
// verbatim (e.g. "tool.search_content") fails this and Strapi rejects the
// whole registerMany() batch at boot.
const STRAPI_ACTION_UID_PATTERN = /^[a-z]([a-z.-]+)[a-z]$/;

const readTool = {
  name: 'searchContent',
  description: 'Search content',
  schema: z.object({ contentType: z.string() }),
  execute: async () => ({}),
  publicSafe: true,
};

const writeTool = {
  name: 'createContent',
  description: 'Create content',
  schema: z.object({ contentType: z.string() }),
  execute: async () => ({}),
};

const internalTool = {
  name: 'saveMemory',
  description: 'Save a memory',
  schema: z.object({ content: z.string() }),
  execute: async () => ({}),
  internal: true,
};

const contributedTool = {
  name: 'ai-sdk-yt-transcripts__fetchTranscript',
  description: 'Fetch a transcript',
  schema: z.object({ videoId: z.string() }),
  execute: async () => ({}),
  publicSafe: true,
};

function registryWith(...defs: any[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const def of defs) registry.register(def);
  return registry;
}

describe('registerMcpAdminPermissions', () => {
  it('registers one action per public tool plus the tool-guide action', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi, registryWith(readTool, writeTool, internalTool));

    // readTool + writeTool + guide (internalTool is excluded from getPublic()).
    expect(captured.actions).toHaveLength(3);
  });

  it('registers built-in tools and the guide under the ai-sdk plugin section', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi, registryWith(readTool, writeTool));

    for (const action of captured.actions) {
      expect(action.section).toBe('plugins');
      expect(action.pluginName).toBe('ai-sdk');
      expect(typeof action.displayName).toBe('string');
    }
  });

  it('uses a hyphenated, source-prefix-free uid for each tool', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi, registryWith(readTool, writeTool));

    const uids = captured.actions.map((a) => a.uid).sort();
    expect(uids).toEqual(['tool.create-content', 'tool.guide', 'tool.search-content']);
  });

  it('every generated uid satisfies the real Strapi admin action uid pattern', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi, registryWith(readTool, writeTool, contributedTool));

    for (const action of captured.actions) {
      expect(action.uid).toMatch(STRAPI_ACTION_UID_PATTERN);
    }
  });

  it('registers a contributed tool under its own plugin\'s section, not ai-sdk', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi, registryWith(contributedTool));

    const action = captured.actions.find((a: any) => a.uid === 'tool.fetch-transcript');
    expect(action).toBeDefined();
    expect(action.pluginName).toBe('ai-sdk-yt-transcripts');
    expect(action.pluginName).not.toBe('ai-sdk');
  });

  it('produces an unambiguous full action id combining plugin section and bare uid', async () => {
    const { strapi, captured } = createFakeStrapi();
    await registerMcpAdminPermissions(strapi, registryWith(contributedTool, readTool));

    const ids = captured.actions.map((a: any) => `plugin::${a.pluginName}.${a.uid}`).sort();
    expect(ids).toEqual(
      [
        'plugin::ai-sdk-yt-transcripts.tool.fetch-transcript',
        'plugin::ai-sdk.tool.guide',
        'plugin::ai-sdk.tool.search-content',
      ].sort(),
    );
  });
});

describe('actionForTool', () => {
  it('derives the full action id from a built-in registry name, owned by ai-sdk', () => {
    expect(actionForTool('searchContent')).toBe('plugin::ai-sdk.tool.search-content');
  });

  it('derives the full action id from a contributed registry name, owned by its source plugin', () => {
    expect(actionForTool('ai-sdk-yt-transcripts__fetchTranscript')).toBe(
      'plugin::ai-sdk-yt-transcripts.tool.fetch-transcript',
    );
  });
});

describe('buildMcpActionDefs', () => {
  it('always includes the tool-guide action, even for an empty registry', () => {
    const defs = buildMcpActionDefs(new ToolRegistry());
    expect(defs).toHaveLength(1);
    expect(defs[0].uid).toBe('tool.guide');
    expect(`plugin::${defs[0].pluginName}.${defs[0].uid}`).toBe(TOOL_GUIDE_ACTION);
  });
});
