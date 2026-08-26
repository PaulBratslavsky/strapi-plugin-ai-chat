import type { UIMessage } from 'ai';

/**
 * Trim messages to a max count while keeping tool call/result pairs intact.
 *
 * When slicing from the end, the first remaining message might carry a tool
 * call whose result never arrived, because the turn that produced it was cut
 * in half. `convertToModelMessages` splits a `UIMessage` into an assistant
 * message plus a separate tool message, and throws `MissingToolResultsError`
 * when it meets a call with no matching result. So the window has to start on
 * a message that does not open one.
 */
export function trimMessages(messages: UIMessage[], max: number): UIMessage[] {
  if (messages.length <= max) return messages;

  const sliced = messages.slice(-max);

  // Drop leading messages until the window starts clean.
  while (sliced.length > 0 && hasOrphanedToolCalls(sliced[0])) {
    sliced.shift();
  }

  return sliced;
}

/**
 * States that mean the call is finished — the part carries its own result, so
 * nothing earlier in the conversation is needed to complete it.
 */
const SETTLED_TOOL_STATES = new Set(['output-available', 'output-error']);

/**
 * A tool part, as the SDK types them: `tool-<toolName>` for a registered tool,
 * or `dynamic-tool` for one resolved at runtime.
 *
 * The exact string `tool-invocation` is the AI SDK v4 name and matches nothing
 * this plugin stores or streams — checking for it made this whole guard inert.
 */
function isToolPart(part: { type?: string }): boolean {
  return (
    typeof part.type === 'string' &&
    (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
  );
}

function hasOrphanedToolCalls(message: UIMessage): boolean {
  if (message.role !== 'assistant') return false;

  // A UIMessage keeps a call and its result on the SAME part, unlike the model
  // message shape it converts into. So a settled tool part is self-contained
  // and safe to lead with; only an unsettled one leaves a call dangling.
  if (message.parts?.length) {
    return message.parts.some(
      (part: any) => isToolPart(part) && !SETTLED_TOOL_STATES.has(part.state),
    );
  }

  // Legacy rows written before the UIMessage migration kept calls in a list
  // beside the text, with no state to inspect. Treat any as unsafe to lead with.
  if ((message as any).toolInvocations?.length) {
    return true;
  }

  return false;
}
