import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createTools } from '../../server/src/tools';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import type { ToolDefinition } from '../../server/src/lib/tool-registry';

/**
 * A tool that never resolves unless its abort signal fires — the shape of the
 * failure this guards against (a network call against a host that is quietly
 * dropping the connection).
 */
const hangingTool = (opts: { honoursSignal: boolean }): ToolDefinition => ({
  name: 'hangs',
  description: 'never comes back',
  schema: z.object({}),
  publicSafe: true,
  execute: (_args, _strapi, context) =>
    new Promise((_resolve, reject) => {
      if (opts.honoursSignal) {
        context?.abortSignal?.addEventListener('abort', () =>
          reject(new Error('aborted by signal')),
        );
      }
    }),
});

const fastTool: ToolDefinition = {
  name: 'fast',
  description: 'returns immediately',
  schema: z.object({}),
  publicSafe: true,
  execute: async () => ({ ok: true }),
};

function fakeStrapi(tools: ToolDefinition[], config: Record<string, unknown> = {}) {
  const registry = new ToolRegistry();
  tools.forEach((t) => registry.register(t));

  return {
    plugin: () => ({ toolRegistry: registry }),
    config: { get: () => config },
  } as any;
}

describe('tool timeouts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('abandons a tool that never returns', async () => {
    const strapi = fakeStrapi([hangingTool({ honoursSignal: false })], { toolTimeoutMs: 1000 });
    const tools = createTools(strapi);

    const call = (tools.hangs as any).execute({}, {});
    const assertion = expect(call).rejects.toThrow(/hangs timed out after 1s/);

    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('tells the model not to assume the call succeeded', async () => {
    const strapi = fakeStrapi([hangingTool({ honoursSignal: false })], { toolTimeoutMs: 1000 });
    const tools = createTools(strapi);

    const call = (tools.hangs as any).execute({}, {});
    const assertion = expect(call).rejects.toThrow(/rather than assuming it succeeded/);

    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('aborts the signal handed to the tool, so a well-behaved tool stops too', async () => {
    const strapi = fakeStrapi([hangingTool({ honoursSignal: true })], { toolTimeoutMs: 1000 });
    const tools = createTools(strapi);

    const call = (tools.hangs as any).execute({}, {});
    // The tool rejects on abort before the timeout's own rejection lands.
    const assertion = expect(call).rejects.toThrow(/aborted by signal/);

    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('leaves a fast tool alone', async () => {
    const strapi = fakeStrapi([fastTool], { toolTimeoutMs: 1000 });
    const tools = createTools(strapi);

    await expect((tools.fast as any).execute({}, {})).resolves.toEqual({ ok: true });
  });

  it('waits forever when the timeout is disabled with 0', async () => {
    const strapi = fakeStrapi([hangingTool({ honoursSignal: false })], { toolTimeoutMs: 0 });
    const tools = createTools(strapi);

    let settled = false;
    void (tools.hangs as any).execute({}, {}).then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
  });

  it('propagates the caller abort signal, so stopping a chat stops the tool', async () => {
    const strapi = fakeStrapi([hangingTool({ honoursSignal: true })], { toolTimeoutMs: 60_000 });
    const tools = createTools(strapi);

    const caller = new AbortController();
    const call = (tools.hangs as any).execute({}, { abortSignal: caller.signal });
    const assertion = expect(call).rejects.toThrow(/aborted by signal/);

    caller.abort();
    await assertion;
  });

  it('applies the 60s default when nothing is configured', async () => {
    const strapi = fakeStrapi([hangingTool({ honoursSignal: false })], {});
    const tools = createTools(strapi);

    const call = (tools.hangs as any).execute({}, {});
    const assertion = expect(call).rejects.toThrow(/timed out after 60s/);

    await vi.advanceTimersByTimeAsync(60_001);
    await assertion;
  });
});
