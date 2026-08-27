import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import { actionForTool } from '../../server/src/mcp/permissions';
import modelService from '../../server/src/services/model';

const builtIn = {
  name: 'searchContent',
  description: 'Search',
  schema: z.object({}),
  execute: async () => ({}),
  publicSafe: true,
};

const pluginTool = {
  name: 'ai_sdk_yt_transcripts__fetch_transcript',
  description: 'Fetch',
  schema: z.object({}),
  execute: async () => ({}),
};

function setup(ability?: { can: (a: string) => boolean }) {
  const registry = new ToolRegistry();
  registry.register(builtIn);
  registry.register(pluginTool);

  const strapi = {
    plugin: () => ({ toolRegistry: registry }),
    config: { get: () => ({}) },
  } as any;

  return { model: modelService({ strapi }), ability };
}

const allowing = (...actions: string[]) => ({
  can: (action: string) => new Set(actions).has(action),
});

describe('getToolSources permission filtering', () => {
  it('hides sources the caller cannot use', async () => {
    const { model, ability } = setup(allowing(actionForTool('searchContent')));

    const sources = model.toolSources(ability);

    const ids = sources.map((s: any) => s.id);
    expect(ids).toEqual(['built-in']);
  });

  it('keeps a plugin source when any of its tools is granted', async () => {
    const { model, ability } = setup(allowing(actionForTool(pluginTool.name)));

    const sources = model.toolSources(ability);

    const ids = sources.map((s: any) => s.id);
    expect(ids).toEqual(['ai_sdk_yt_transcripts']);
  });

  it('returns nothing when the caller is granted nothing', async () => {
    const { model, ability } = setup(allowing());

    const sources = model.toolSources(ability);

    expect(sources).toEqual([]);
  });

  it('does not filter when no ability is present', async () => {
    const { model, ability } = setup();

    const sources = model.toolSources(ability);

    expect(sources).toHaveLength(2);
  });
});
