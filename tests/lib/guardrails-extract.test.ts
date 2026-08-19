import { describe, it, expect } from 'vitest';
import { extractUserInput } from '../../server/src/guardrails/index';

function fakeCtx(path: string, method: string, body: unknown) {
  return { path, method, request: { body } } as any;
}

describe('extractUserInput', () => {


  it('still extracts from /chat with route chat (no regression)', () => {
    const body = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello there' }] }],
    };
    const result = extractUserInput(fakeCtx('/api/ai-sdk/chat', 'POST', body));
    expect(result).toEqual({ text: 'hello there', route: 'chat' });
  });

  it('still extracts prompt from /ask', () => {
    const body = { prompt: 'what is the weather' };
    const result = extractUserInput(fakeCtx('/api/ai-sdk/ask', 'POST', body));
    expect(result).toEqual({ text: 'what is the weather', route: 'ask' });
  });

  it('still extracts prompt from /ask-stream', () => {
    const body = { prompt: 'stream this please' };
    const result = extractUserInput(fakeCtx('/api/ai-sdk/ask-stream', 'POST', body));
    expect(result).toEqual({ text: 'stream this please', route: 'ask-stream' });
  });

  it('returns null for /mcp paths (dead MCP branches removed — no /mcp route exists in this plugin)', () => {
    const result = extractUserInput(
      fakeCtx('/api/ai-sdk/mcp', 'POST', { params: { foo: 'bar' } })
    );
    expect(result).toBeNull();
  });

  it('returns null for a non-matching path', () => {
    const result = extractUserInput(fakeCtx('/api/ai-sdk/unknown-route', 'POST', { foo: 'bar' }));
    expect(result).toBeNull();
  });
});

