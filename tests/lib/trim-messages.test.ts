import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { trimMessages } from '../../server/src/lib/trim-messages';

const user = (id: string, text = 'hi'): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage;

const assistantText = (id: string, text = 'ok'): UIMessage =>
  ({ id, role: 'assistant', parts: [{ type: 'text', text }] }) as UIMessage;

/** An assistant turn whose tool call completed — call and result on one part. */
const assistantSettledTool = (id: string): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-searchContent',
        toolCallId: `${id}-call`,
        state: 'output-available',
        input: { query: 'x' },
        output: { results: [] },
      },
    ],
  }) as unknown as UIMessage;

/** An assistant turn cut off mid-call — no result on the part. */
const assistantDanglingTool = (id: string, state = 'input-available'): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-createContent',
        toolCallId: `${id}-call`,
        state,
        input: { title: 'x' },
      },
    ],
  }) as unknown as UIMessage;

describe('trimMessages', () => {
  it('returns the input untouched when it already fits', () => {
    const messages = [user('1'), assistantText('2')];
    expect(trimMessages(messages, 5)).toBe(messages);
  });

  it('keeps only the last `max` messages', () => {
    const messages = [user('1'), assistantText('2'), user('3'), assistantText('4')];
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['3', '4']);
  });

  it('drops a leading assistant message whose tool call has no result', () => {
    const messages = [user('1'), user('2'), assistantDanglingTool('3'), user('4')];

    // The window would start on '3', which opens a call nothing answers.
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['4']);
  });

  it('treats input-streaming as unsettled too', () => {
    const messages = [
      user('1'),
      user('2'),
      assistantDanglingTool('3', 'input-streaming'),
      user('4'),
    ];
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['4']);
  });

  it('keeps a leading assistant message whose tool call completed', () => {
    const messages = [user('1'), user('2'), assistantSettledTool('3'), user('4')];

    // Call and result live on the same part, so nothing is dangling.
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['3', '4']);
  });

  it('keeps a leading assistant message whose tool call errored', () => {
    const errored = {
      id: '3',
      role: 'assistant',
      parts: [
        {
          type: 'tool-createContent',
          toolCallId: '3-call',
          state: 'output-error',
          input: {},
          errorText: 'nope',
        },
      ],
    } as unknown as UIMessage;

    const messages = [user('1'), user('2'), errored, user('4')];
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['3', '4']);
  });

  it('handles dynamic-tool parts', () => {
    const dynamic = {
      id: '3',
      role: 'assistant',
      parts: [{ type: 'dynamic-tool', toolCallId: '3-call', state: 'input-available' }],
    } as unknown as UIMessage;

    const messages = [user('1'), user('2'), dynamic, user('4')];
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['4']);
  });

  it('never drops a leading user message', () => {
    const messages = [assistantText('1'), assistantText('2'), user('3'), user('4')];
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['3', '4']);
  });

  it('drops several dangling messages in a row', () => {
    const messages = [
      user('1'),
      assistantDanglingTool('2'),
      assistantDanglingTool('3'),
      user('4'),
    ];
    expect(trimMessages(messages, 3).map((m) => m.id)).toEqual(['4']);
  });

  it('treats a legacy toolInvocations row as unsafe to lead with', () => {
    const legacy = {
      id: '3',
      role: 'assistant',
      parts: [],
      toolInvocations: [{ toolCallId: 'x', toolName: 'searchContent' }],
    } as unknown as UIMessage;

    const messages = [user('1'), user('2'), legacy, user('4')];
    expect(trimMessages(messages, 2).map((m) => m.id)).toEqual(['4']);
  });

  it('can empty the window when every remaining message dangles', () => {
    const messages = [user('1'), assistantDanglingTool('2'), assistantDanglingTool('3')];
    expect(trimMessages(messages, 2)).toEqual([]);
  });
});
