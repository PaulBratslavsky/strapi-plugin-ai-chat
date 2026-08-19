import { describe, it, expect } from 'vitest';
import { toRenderMessage, toRenderMessages } from '../../admin/src/utils/message-adapter';

describe('toRenderMessage', () => {
  it('flattens text parts into content', () => {
    const result = toRenderMessage({
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
    });

    expect(result.content).toBe('hello');
  });

  it('collects tool parts, carrying input and output', () => {
    const result = toRenderMessage({
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchContent',
          toolCallId: 'c1',
          toolName: 'searchContent',
          state: 'output-available',
          input: { q: 'strapi' },
          output: { count: 2 },
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      { toolCallId: 'c1', toolName: 'searchContent', input: { q: 'strapi' }, output: { count: 2 } },
    ]);
  });

  it('omits output for a tool call that has not returned yet', () => {
    const result = toRenderMessage({
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'tool-x', toolCallId: 'c1', toolName: 'x', input: {} }],
    });

    expect(result.toolCalls?.[0]).not.toHaveProperty('output');
  });

  it('derives the tool name from the part type when toolName is absent', () => {
    const result = toRenderMessage({
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'tool-uploadMedia', toolCallId: 'c1' }],
    });

    expect(result.toolCalls?.[0].toolName).toBe('uploadMedia');
  });

  it('joins multiple text parts rather than keeping only one', () => {
    const result = toRenderMessage({
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Let me search' },
        { type: 'tool-searchContent', toolCallId: 'c1', toolName: 'searchContent' },
        { type: 'text', text: 'Here is what I found' },
      ],
    });

    // interleaving cannot survive a single `content` field, but no text is lost
    expect(result.content).toBe('Let me search\n\nHere is what I found');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('skips part types the current UI cannot render', () => {
    const result = toRenderMessage({
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'thinking out loud' },
        { type: 'text', text: 'answer' },
      ],
    });

    expect(result.content).toBe('answer');
  });

  it('passes an already-rendered message through untouched', () => {
    const legacy = { id: 'm1', role: 'user' as const, content: 'hi' };

    expect(toRenderMessage(legacy)).toBe(legacy);
  });
});

describe('toRenderMessages', () => {
  it('returns empty for a non-array', () => {
    expect(toRenderMessages(null)).toEqual([]);
    expect(toRenderMessages({ v: 2 })).toEqual([]);
  });

  it('maps a list', () => {
    const result = toRenderMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]);

    expect(result.map((m) => m.content)).toEqual(['hi', 'hello']);
  });
});
