import { describe, it, expect } from 'vitest';
import { AIProvider } from '../../server/src/lib/ai-provider';

const silent = { warn: () => {} };

describe('AIProvider.initialize provider requirements', () => {
  it('accepts openai-compatible with a baseURL and no apiKey', () => {
    // Ollama, vLLM and LM Studio have no auth; requiring a key forced a dummy
    // value into config for the setup this plugin most wants to make easy
    const provider = new AIProvider();

    const ok = provider.initialize(
      { provider: 'openai-compatible', baseURL: 'http://localhost:11434/v1' },
      silent,
    );

    expect(ok).toBe(true);
  });

  it('rejects openai-compatible without a baseURL', () => {
    const provider = new AIProvider();

    const ok = provider.initialize({ provider: 'openai-compatible', apiKey: 'x' }, silent);

    expect(ok).toBe(false);
  });

  it('explains what is missing when baseURL is absent', () => {
    const messages: string[] = [];
    const provider = new AIProvider();

    provider.initialize({ provider: 'openai-compatible' }, { warn: (m) => messages.push(m) });

    expect(messages.join(' ')).toMatch(/baseURL/);
  });

  it('treats a blank baseURL as absent rather than as a URL', () => {
    // `env('AI_BASE_URL')` returns "" for a variable that exists but is empty.
    // Passed through, the Anthropic SDK joins it with the request path and
    // calls `/messages`, failing as `Invalid URL` instead of as a config error.
    const provider = new AIProvider();

    const ok = provider.initialize({ provider: 'anthropic', apiKey: 'k', baseURL: '' }, silent);

    expect(ok).toBe(true);
    expect((provider as any).baseURL).toBeUndefined();
  });

  it('treats a whitespace-only baseURL as absent', () => {
    const provider = new AIProvider();

    provider.initialize({ provider: 'anthropic', apiKey: 'k', baseURL: '   ' }, silent);

    expect((provider as any).baseURL).toBeUndefined();
  });

  it('rejects openai-compatible when baseURL is blank', () => {
    const provider = new AIProvider();

    expect(provider.initialize({ provider: 'openai-compatible', baseURL: '  ' }, silent)).toBe(false);
  });

  it('trims a baseURL that carries stray whitespace', () => {
    const provider = new AIProvider();

    provider.initialize(
      { provider: 'openai-compatible', baseURL: '  http://localhost:11434/v1  ' },
      silent,
    );

    expect((provider as any).baseURL).toBe('http://localhost:11434/v1');
  });

  it('still requires an apiKey for anthropic', () => {
    const provider = new AIProvider();

    expect(provider.initialize({ provider: 'anthropic' }, silent)).toBe(false);
  });

  it('accepts anthropic with an apiKey', () => {
    const provider = new AIProvider();

    expect(provider.initialize({ provider: 'anthropic', apiKey: 'sk-test' }, silent)).toBe(true);
  });

  it('defaults to anthropic when no provider is named', () => {
    const provider = new AIProvider();

    expect(provider.initialize({ apiKey: 'sk-test' }, silent)).toBe(true);
    expect(provider.initialize({}, silent)).toBe(false);
  });
})
