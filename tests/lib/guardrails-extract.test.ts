import { describe, it, expect } from 'vitest';
import { extractUserInput } from '../../server/src/guardrails/index';

function fakeCtx(path: string, method: string, body: unknown) {
  return { path, method, request: { body } } as any;
}

describe('extractUserInput', () => {
  it('extracts the last user message from /chat', () => {
    const body = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello there' }] }],
    };
    const result = extractUserInput(fakeCtx('/api/ai-sdk/chat', 'POST', body));
    expect(result).toEqual({ text: 'hello there', route: 'chat' });
  });

  it('reads the legacy content string when there are no parts', () => {
    const body = { messages: [{ role: 'user', content: 'legacy shape' }] };
    const result = extractUserInput(fakeCtx('/api/ai-sdk/chat', 'POST', body));
    expect(result).toEqual({ text: 'legacy shape', route: 'chat' });
  });

  it('screens the most recent user message, not an earlier one', () => {
    const body = {
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'first' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
        { role: 'user', parts: [{ type: 'text', text: 'second' }] },
      ],
    };
    const result = extractUserInput(fakeCtx('/api/ai-sdk/chat', 'POST', body));
    expect(result).toEqual({ text: 'second', route: 'chat' });
  });

  it('ignores GET on the chat path', () => {
    const body = { messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }] };
    expect(extractUserInput(fakeCtx('/api/ai-sdk/chat', 'GET', body))).toBeNull();
  });

  /**
   * `/ask` and `/ask-stream` are real routes — in strapi-plugin-ai-sdk-public-chat,
   * which ships its own copy of these guardrails and screens them there. This
   * plugin has no such routes, so recognising them here would be dead code
   * claiming to guard a surface it never sees.
   */
  it('ignores /ask, which belongs to the public-chat plugin', () => {
    const body = { prompt: 'what is the weather' };
    expect(extractUserInput(fakeCtx('/api/ai-sdk/ask', 'POST', body))).toBeNull();
  });

  it('ignores /ask-stream, which belongs to the public-chat plugin', () => {
    const body = { prompt: 'stream this please' };
    expect(extractUserInput(fakeCtx('/api/ai-sdk/ask-stream', 'POST', body))).toBeNull();
  });

  it('returns null for /mcp paths — this plugin serves no MCP route', () => {
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
