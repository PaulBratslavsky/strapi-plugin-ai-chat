import type { UIMessage } from 'ai';

/**
 * Close tool calls that never produced a result.
 *
 * `convertToModelMessages` splits one `UIMessage` into an assistant message
 * plus a separate tool message, and throws `MissingToolResultsError` the moment
 * it meets a call with no matching result. A conversation containing such a
 * call is then unusable: every subsequent turn fails on history that was
 * written once and is replayed forever.
 *
 * A turn can be cut off mid-call in several ordinary ways - the reader presses
 * Stop, the request is aborted, the step limit lands between a call and its
 * result, a stream dies. Each leaves a part stuck in `input-streaming` or
 * `input-available`, and the panel persists it along with everything else.
 *
 * `trimMessages` guarded against this, but only for the first message of a
 * trimmed window, and only when the conversation was long enough to trim at
 * all. A short conversation skipped the check entirely, which is the case that
 * reached production.
 *
 * Rather than dropping the part, it is settled as an error. The model then sees
 * that the tool was started and did not finish, which is the truth, and is the
 * thing it needs in order to retry rather than assume the work was done.
 */

/** States that carry their own result, so the call is complete. */
const SETTLED = new Set(['output-available', 'output-error']);

/** `tool-<toolName>` for a registered tool, `dynamic-tool` for a runtime one. */
function isToolPart(part: { type?: string }): boolean {
  return (
    typeof part.type === 'string' && (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
  );
}

function isDangling(part: any): boolean {
  return isToolPart(part) && !SETTLED.has(part?.state);
}

/** Does this history contain a call that would fail conversion? */
export function hasDanglingToolCalls(messages: UIMessage[]): boolean {
  return messages.some((m) => (m.parts ?? []).some(isDangling));
}

export function settleDanglingToolCalls(messages: UIMessage[]): {
  messages: UIMessage[];
  settled: number;
} {
  let settled = 0;

  const out = messages.map((message) => {
    if (!message.parts?.length || !message.parts.some(isDangling)) return message;

    return {
      ...message,
      parts: message.parts.map((part: any) => {
        if (!isDangling(part)) return part;

        settled += 1;
        return {
          ...part,
          state: 'output-error',
          errorText:
            part.errorText ??
            'This tool call did not finish. The turn was interrupted before a result ' +
              'arrived, so nothing was returned and no work should be assumed complete.',
        };
      }),
    };
  });

  return { messages: out as UIMessage[], settled };
}
