import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import { actionForTool } from '../../server/src/mcp/permissions';
import controllerFactory from '../../server/src/controllers/controller';

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

  const strapi = { plugin: () => ({ toolRegistry: registry }) } as any;
  const ctx: any = { state: ability ? { userAbility: ability } : {}, badRequest: () => {} };

  return { controller: controllerFactory({ strapi }), ctx };
}

const allowing = (...actions: string[]) => ({
  can: (action: string) => new Set(actions).has(action),
});

describe('getToolSources permission filtering', () => {
  it('hides sources the caller cannot use', async () => {
    const { controller, ctx } = setup(allowing(actionForTool('searchContent')));

    await controller.getToolSources(ctx);

    const ids = ctx.body.data.map((s: any) => s.id);
    expect(ids).toEqual(['built-in']);
  });

  it('keeps a plugin source when any of its tools is granted', async () => {
    const { controller, ctx } = setup(allowing(actionForTool(pluginTool.name)));

    await controller.getToolSources(ctx);

    const ids = ctx.body.data.map((s: any) => s.id);
    expect(ids).toEqual(['ai_sdk_yt_transcripts']);
  });

  it('returns nothing when the caller is granted nothing', async () => {
    const { controller, ctx } = setup(allowing());

    await controller.getToolSources(ctx);

    expect(ctx.body.data).toEqual([]);
  });

  it('does not filter when no ability is present', async () => {
    const { controller, ctx } = setup();

    await controller.getToolSources(ctx);

    expect(ctx.body.data).toHaveLength(2);
  });
});
