import { describe, it, expect } from 'vitest';
import {
  readStoredMessages,
  toStoredMessages,
  STORAGE_VERSION,
} from '../../server/src/lib/stored-messages';

/** A conversation as written by 2.0.x and earlier. */
const legacyRow = [
  { id: 'm1', role: 'user', content: 'find me articles about strapi' },
  {
    id: 'm2',
    role: 'assistant',
    content: 'Here are three articles.',
    toolCalls: [
      {
        toolCallId: 'call-1',
        toolName: 'searchContent',
        input: { contentType: 'api::article.article' },
        output: { count: 3 },
      },
    ],
  },
];

const v2Row = {
  v: STORAGE_VERSION,
  messages: [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
  ],
};

describe('readStoredMessages', () => {
  it('reads a current-version row unchanged', () => {
    const result = readStoredMessages(v2Row);

    expect(result.migrated).toBe(false);
    expect(result.messages).toEqual(v2Row.messages);
  });

  it('migrates a legacy bare array', () => {
    const result = readStoredMessages(legacyRow);

    expect(result.migrated).toBe(true);
    expect(result.messages).toHaveLength(2);
  });

  it('turns legacy content into a text part', () => {
    const { messages } = readStoredMessages(legacyRow);

    expect(messages[0].parts).toEqual([
      { type: 'text', text: 'find me articles about strapi' },
    ]);
  });

  it('turns a legacy toolCall into a tool part carrying its input and output', () => {
    const { messages } = readStoredMessages(legacyRow);
    const toolPart = messages[1].parts.find((p) => p.type.startsWith('tool-')) as any;

    expect(toolPart).toMatchObject({
      type: 'tool-searchContent',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { contentType: 'api::article.article' },
      output: { count: 3 },
    });
  });

  it('marks a tool call still awaiting output as input-available', () => {
    const pending = [
      {
        id: 'm1',
        role: 'assistant',
        content: '',
        toolCalls: [{ toolCallId: 'c', toolName: 'searchContent', input: {} }],
      },
    ];

    const { messages } = readStoredMessages(pending);
    const part = messages[0].parts[0] as any;

    expect(part.state).toBe('input-available');
    expect(part).not.toHaveProperty('output');
  });

  it('preserves text-then-tool ordering when migrating', () => {
    const { messages } = readStoredMessages(legacyRow);

    expect(messages[1].parts.map((p) => p.type)).toEqual(['text', 'tool-searchContent']);
  });

  it('gives a legacy message without an id a generated one', () => {
    const { messages } = readStoredMessages([{ role: 'user', content: 'hi' }]);

    expect(messages[0].id).toBeTruthy();
  });

  it('returns empty for null rather than throwing', () => {
    expect(readStoredMessages(null).messages).toEqual([]);
    expect(readStoredMessages(undefined).messages).toEqual([]);
  });

  it('degrades a corrupt row to empty and reports why', () => {
    const result = readStoredMessages({ nonsense: true });

    // a broken row costs that conversation's history, not the whole page
    expect(result.messages).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('keeps part types it does not understand', () => {
    const withReasoning = {
      v: STORAGE_VERSION,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'thinking' },
            { type: 'source-url', url: 'https://example.com' },
          ],
        },
      ],
    };

    const { messages } = readStoredMessages(withReasoning);

    // dropping unknown parts would silently damage the row for a future
    // version that does understand them
    expect(messages[0].parts).toHaveLength(2);
    expect(messages[0].parts.map((p) => p.type)).toEqual(['reasoning', 'source-url']);
  });
});

describe('toStoredMessages', () => {
  it('wraps a bare UIMessage array in the current envelope', () => {
    const result = toStoredMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.v).toBe(STORAGE_VERSION);
  });

  it('accepts an already-wrapped envelope', () => {
    const result = toStoredMessages(v2Row);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.messages).toEqual(v2Row.messages);
  });

  it('accepts the legacy shape and normalises it on the way in', () => {
    // an older admin panel during a rolling upgrade must not fail to save
    const result = toStoredMessages(legacyRow);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.v).toBe(STORAGE_VERSION);
      expect(result.value.messages[1].parts.some((p) => p.type.startsWith('tool-'))).toBe(true);
    }
  });

  it('rejects a payload that is neither shape', () => {
    const result = toStoredMessages({ messages: 'not an array' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('rejects a message missing a role', () => {
    const result = toStoredMessages([{ id: 'm1', parts: [] }]);

    expect(result.ok).toBe(false);
  });

  it('round-trips: what it writes is what it reads back', () => {
    const written = toStoredMessages(legacyRow);
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const read = readStoredMessages(written.value);

    expect(read.migrated).toBe(false);
    expect(read.messages).toEqual(written.value.messages);
  });
});
