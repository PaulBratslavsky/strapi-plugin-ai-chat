import { describe, it, expect } from 'vitest';
import {
  detectContextWindow,
  warnAboutBudget,
  measureTools,
  estimateTokens,
  OLLAMA_DEFAULT_NUM_CTX,
} from '../../server/src/lib/context-budget';

/** Stands in for Ollama, so the tests do not need one running. */
function ollama({ numCtx, trained, running }: { numCtx?: number; trained: number; running?: number }) {
  return (async (url: string) => {
    if (String(url).endsWith('/api/ps')) {
      return {
        ok: true,
        json: async () => ({ models: running ? [{ name: 'm', context_length: running }] : [] }),
      } as any;
    }
    return {
      ok: true,
      json: async () => ({
        model_info: { 'general.context_length': trained },
        parameters: numCtx ? `stop "x"\nnum_ctx                        ${numCtx}` : 'stop "x"',
      }),
    } as any;
  }) as unknown as typeof fetch;
}

const cfg = { baseURL: 'http://localhost:11434/v1', chatModel: 'm' } as any;

describe('detectContextWindow', () => {
  it('prefers an explicit config value over anything detected', async () => {
    const r = await detectContextWindow({ ...cfg, contextWindow: 8000 }, ollama({ trained: 1 }));

    expect(r).toEqual({ window: 8000, source: 'config' });
  });

  it('reports the window a running instance is actually serving', async () => {
    const r = await detectContextWindow(cfg, ollama({ trained: 262144, numCtx: 32768, running: 16384 }));

    expect(r.window).toBe(16384);
    expect(r.source).toBe('ollama-running');
  });

  it('falls back to the model file when nothing is loaded', async () => {
    const r = await detectContextWindow(cfg, ollama({ trained: 131072, numCtx: 32768 }));

    expect(r.window).toBe(32768);
    expect(r.source).toBe('ollama-modelfile');
  });

  it("reports Ollama's default when the model file sets no num_ctx", async () => {
    // The case that looks like a broken plugin: a model advertising a huge
    // context is served a fraction of it and nothing says so.
    const r = await detectContextWindow(cfg, ollama({ trained: 262144 }));

    expect(r.window).toBe(OLLAMA_DEFAULT_NUM_CTX);
    expect(r.source).toBe('ollama-default');
    expect(r.trained).toBe(262144);
  });

  it('reports unknown rather than guessing when there is no baseURL', async () => {
    const r = await detectContextWindow({ chatModel: 'claude-sonnet-5' } as any, ollama({ trained: 1 }));

    expect(r).toEqual({ window: null, source: 'unknown' });
  });

  it('survives an endpoint that cannot be reached', async () => {
    const dead = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    expect(await detectContextWindow(cfg, dead)).toEqual({ window: null, source: 'unknown' });
  });
});

describe('warnAboutBudget', () => {
  const base = {
    systemTokens: 1688,
    toolTokens: 5308,
    toolCount: 19,
    preambleTokens: 6996,
    preambleShare: null,
    trainedContext: null,
  };

  it('says requests cannot fit when the preamble exceeds the window', () => {
    const w = warnAboutBudget({
      ...base,
      contextWindow: 4096,
      windowSource: 'ollama-default',
      trainedContext: 262144,
    } as any);

    expect(w).toMatch(/cannot fit/);
    expect(w).toMatch(/262144/);
    expect(w).toMatch(/num_ctx/);
  });

  it('warns when the preamble takes more than half the window', () => {
    const w = warnAboutBudget({ ...base, contextWindow: 12000, windowSource: 'config' } as any);

    expect(w).toMatch(/little room/);
  });

  it('flags a model truncated by the default even when the preamble fits', () => {
    const w = warnAboutBudget({
      ...base,
      preambleTokens: 500,
      contextWindow: 4096,
      windowSource: 'ollama-default',
      trainedContext: 131072,
    } as any);

    expect(w).toMatch(/131072/);
  });

  it('stays quiet when the budget is comfortable', () => {
    const w = warnAboutBudget({
      ...base,
      contextWindow: 32768,
      windowSource: 'ollama-modelfile',
      trainedContext: 131072,
    } as any);

    expect(w).toBeNull();
  });

  it('says nothing when the window is unknown, rather than inventing a verdict', () => {
    expect(warnAboutBudget({ ...base, contextWindow: null, windowSource: 'unknown' } as any)).toBeNull();
  });
});

describe('measureTools', () => {
  it('counts tools and charges for their serialised schemas', () => {
    const tools = {
      a: { description: 'does a thing', inputSchema: { jsonSchema: { type: 'object' } } },
      b: { description: 'does another', inputSchema: { jsonSchema: { type: 'object' } } },
    } as any;

    const m = measureTools(tools);

    expect(m.count).toBe(2);
    expect(m.tokens).toBeGreaterThan(0);
  });

  it('skips a schema that will not serialise instead of failing the report', () => {
    const circular: any = {};
    circular.self = circular;

    expect(() => measureTools({ a: { description: 'x', inputSchema: circular } } as any)).not.toThrow();
  });

  it('reports zero tools without dividing by anything', () => {
    expect(measureTools({} as any)).toEqual({ count: 0, tokens: 0 });
  });
});

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('handles an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
