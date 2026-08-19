import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import { createTools } from '../../server/src/tools';
import { actionForTool } from '../../server/src/mcp/permissions';

const searchTool = {
  name: 'searchContent',
  description: 'Search content',
  schema: z.object({ contentType: z.string() }),
  execute: async () => ({ results: [] }),
  publicSafe: true,
};

const createTool = {
  name: 'createContent',
  description: 'Create content',
  schema: z.object({ contentType: z.string() }),
  execute: async () => ({ ok: true }),
};

const pluginTool = {
  name: 'ai_sdk_yt_transcripts__fetch_transcript',
  description: 'Fetch a transcript',
  schema: z.object({ videoId: z.string() }),
  execute: async () => ({ ok: true }),
};

/** Strapi hands us a CASL ability; only `can(action)` is used. */
function abilityAllowing(...actions: string[]) {
  const allowed = new Set(actions);
  return { can: (action: string) => allowed.has(action) };
}

function strapiWith(...defs: any[]): any {
  const registry = new ToolRegistry();
  for (const def of defs) registry.register(def);
  return { plugin: () => ({ toolRegistry: registry }) };
}

describe('createTools RBAC filtering', () => {
  it('withholds tools the caller has no permission for', () => {
    const strapi = strapiWith(searchTool, createTool, pluginTool);
    const ability = abilityAllowing(actionForTool('searchContent'));

    const tools = createTools(strapi, { ability });

    expect(Object.keys(tools)).toEqual(['searchContent']);
  });

  it('includes a contributed plugin tool when its owning-plugin action is granted', () => {
    const strapi = strapiWith(searchTool, pluginTool);
    const ability = abilityAllowing(actionForTool(pluginTool.name));

    const tools = createTools(strapi, { ability });

    expect(Object.keys(tools)).toEqual([pluginTool.name]);
  });

  it('returns nothing when the caller is granted no tool actions', () => {
    const strapi = strapiWith(searchTool, createTool);

    const tools = createTools(strapi, { ability: abilityAllowing() });

    expect(Object.keys(tools)).toEqual([]);
  });

  it('does not filter when no ability is supplied (non-HTTP callers stay trusted)', () => {
    const strapi = strapiWith(searchTool, createTool, pluginTool);

    const tools = createTools(strapi, {});

    expect(Object.keys(tools)).toHaveLength(3);
  });

  it('applies RBAC on top of enabledToolSources rather than replacing it', () => {
    const strapi = strapiWith(searchTool, pluginTool);
    // Source is disabled in config, but the action IS granted — config still wins.
    const ability = abilityAllowing(
      actionForTool('searchContent'),
      actionForTool(pluginTool.name),
    );

    const tools = createTools(strapi, { ability, enabledToolSources: [] });

    expect(Object.keys(tools)).toEqual(['searchContent']);
  });
});
