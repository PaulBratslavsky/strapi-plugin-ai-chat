import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createTools } from '../../server/src/tools';
import { ToolRegistry } from '../../server/src/lib/tool-registry';

/**
 * The coalescer has to work through createTools, not just on its own: that is
 * where a duplicate call actually arrives.
 */
function setup(onExecute: () => Promise<unknown>) {
  const registry = new ToolRegistry();
  registry.register({
    name: 'fetchTranscript',
    description: 'Fetch a transcript',
    schema: z.object({ videoId: z.string() }),
    execute: onExecute,
    publicSafe: true,
  });

  const strapi = {
    plugin: () => ({ toolRegistry: registry }),
    config: { get: () => ({}) },
  } as any;

  return createTools(strapi);
}

describe('duplicate concurrent tool calls', () => {
  it('execute once when the model fires the same call twice', async () => {
    let runs = 0;
    const tools: any = setup(async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { transcript: 'x'.repeat(100) };
    });

    const [a, b] = await Promise.all([
      tools.fetchTranscript.execute({ videoId: 'kCYfglngpTA' }),
      tools.fetchTranscript.execute({ videoId: 'kCYfglngpTA' }),
    ]);

    expect(runs).toBe(1);
    expect(a).toEqual(b);
  });

  it('still executes twice for different videos', async () => {
    let runs = 0;
    const tools: any = setup(async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true };
    });

    await Promise.all([
      tools.fetchTranscript.execute({ videoId: 'a' }),
      tools.fetchTranscript.execute({ videoId: 'b' }),
    ]);

    expect(runs).toBe(2);
  });

  it('a sequential repeat still runs, since nothing is cached', async () => {
    let runs = 0;
    const tools: any = setup(async () => { runs += 1; return { ok: true }; });

    await tools.fetchTranscript.execute({ videoId: 'a' });
    await tools.fetchTranscript.execute({ videoId: 'a' });

    expect(runs).toBe(2);
  });

  it('both callers see the same failure, executed once', async () => {
    let runs = 0;
    const tools: any = setup(async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('YouTube refused');
    });

    const results = await Promise.allSettled([
      tools.fetchTranscript.execute({ videoId: 'a' }),
      tools.fetchTranscript.execute({ videoId: 'a' }),
    ]);

    expect(runs).toBe(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });
});
