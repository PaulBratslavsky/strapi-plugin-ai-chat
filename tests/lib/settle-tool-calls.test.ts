import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { convertToModelMessages } from 'ai';
import { settleDanglingToolCalls, hasDanglingToolCalls } from '../../server/src/lib/settle-tool-calls';
import { trimMessages } from '../../server/src/lib/trim-messages';

const user = (id: string): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text: 'hi' }] }) as UIMessage;

/** An assistant turn whose tool call never produced a result. */
const dangling = (id: string, state = 'input-available'): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [{ type: 'tool-createContent', toolCallId: `call-${id}`, state, input: {} }],
  }) as unknown as UIMessage;

const settledCall = (id: string): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      { type: 'tool-createContent', toolCallId: `call-${id}`, state: 'output-available', input: {}, output: { ok: true } },
    ],
  }) as unknown as UIMessage;

describe('settleDanglingToolCalls', () => {
  it('closes a call left open by an interrupted turn', () => {
    const { messages, settled } = settleDanglingToolCalls([user('u1'), dangling('a1')]);

    expect(settled).toBe(1);
    const part = (messages[1] as any).parts[0];
    expect(part.state).toBe('output-error');
    expect(part.errorText).toMatch(/did not finish/i);
  });

  it('handles a call still streaming its input', () => {
    const { settled } = settleDanglingToolCalls([dangling('a1', 'input-streaming')]);

    expect(settled).toBe(1);
  });

  it('leaves a completed call alone', () => {
    const { messages, settled } = settleDanglingToolCalls([settledCall('a1')]);

    expect(settled).toBe(0);
    expect((messages[0] as any).parts[0].state).toBe('output-available');
  });

  it('leaves an already-errored call alone rather than rewriting its message', () => {
    const errored = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'tool-x', toolCallId: 'c', state: 'output-error', errorText: 'original reason' }],
    } as unknown as UIMessage;

    const { messages, settled } = settleDanglingToolCalls([errored]);

    expect(settled).toBe(0);
    expect((messages[0] as any).parts[0].errorText).toBe('original reason');
  });

  it('settles a dangling call anywhere, not just the first message', () => {
    // The bug this guards: the old check only looked at the first message of a
    // trimmed window.
    const { settled } = settleDanglingToolCalls([user('u1'), settledCall('a1'), user('u2'), dangling('a2')]);

    expect(settled).toBe(1);
  });

  it('returns the original messages untouched when nothing dangles', () => {
    const input = [user('u1'), settledCall('a1')];
    const { messages } = settleDanglingToolCalls(input);

    expect(messages[0]).toBe(input[0]);
    expect(messages[1]).toBe(input[1]);
  });
});

describe('hasDanglingToolCalls', () => {
  it('detects one', () => {
    expect(hasDanglingToolCalls([user('u1'), dangling('a1')])).toBe(true);
  });

  it('is false for a clean history', () => {
    expect(hasDanglingToolCalls([user('u1'), settledCall('a1')])).toBe(false);
  });
});

/**
 * The failure that reached production.
 *
 * MissingToolResultsError is thrown by convertToLanguageModelPrompt inside
 * streamText, not by convertToModelMessages, so the thing to assert is the
 * shape conversion produces: an assistant tool-call whose id is never matched
 * by a tool-result. That is the exact condition the SDK counts.
 */
describe('the production failure', () => {
  const short = [user('u1'), dangling('a1'), user('u2')];

  /** Count tool calls left unmatched, the way the SDK does before it throws. */
  async function unmatchedToolCalls(messages: UIMessage[]): Promise<number> {
    const converted = (await convertToModelMessages(messages)) as any[];
    const ids = new Set<string>();

    for (const m of converted) {
      if (m.role === 'assistant') {
        for (const c of m.content ?? []) if (c.type === 'tool-call') ids.add(c.toolCallId);
      }
      if (m.role === 'tool') {
        for (const c of m.content ?? []) if (c.type === 'tool-result') ids.delete(c.toolCallId);
      }
    }

    return ids.size;
  }

  it('an interrupted turn converts to an unmatched tool call', async () => {
    expect(await unmatchedToolCalls(short)).toBe(1);
  });

  it('a short conversation never reached the old trim guard', () => {
    // trimMessages returns early when the history fits, so nothing was checked.
    expect(trimMessages(short, 15)).toBe(short);
  });

  it('settling first leaves nothing unmatched', async () => {
    const { messages } = settleDanglingToolCalls(short);

    expect(await unmatchedToolCalls(messages)).toBe(0);
  });

  it('settling adds the tool message the conversion was missing', async () => {
    const before = (await convertToModelMessages(short)) as any[];
    const { messages } = settleDanglingToolCalls(short);
    const after = (await convertToModelMessages(messages)) as any[];

    expect(before.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(after.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
  });
});
