import type { Message, ToolCall } from '../hooks/useChat';

/**
 * Bridge between the stored `UIMessage` shape and the `Message` shape the
 * current UI renders.
 *
 * The server now persists the AI SDK's `UIMessage` — an ordered `parts[]`
 * array — while `MessageList` and `ToolCallDisplay` still expect
 * `{ content, toolCalls }`. This module exists only to span that gap, and is
 * expected to be deleted: once the admin panel moves to the SDK's `useChat`,
 * both sides speak `UIMessage` and there is nothing left to convert.
 *
 * See `docs/plans/useChat-sdk-migration.md`.
 */

interface UIPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

interface UIMessageLike {
  id: string;
  role: string;
  parts?: UIPart[];
}

/** True for anything already in the current `Message` shape. */
function looksLegacy(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && 'content' in (value as object);
}

/**
 * Flatten one stored message for rendering.
 *
 * Interleaving is lost here — several text parts separated by a tool call
 * collapse into one string, because `Message.content` is a single field. That
 * loss is in the renderer only; the stored row keeps the true order, so it
 * comes back intact once the UI can display it.
 */
export function toRenderMessage(message: UIMessageLike | Message): Message {
  if (looksLegacy(message)) return message;

  const parts = message.parts ?? [];
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      text.push(part.text);
      continue;
    }

    if (part.type.startsWith('tool-')) {
      toolCalls.push({
        toolCallId: part.toolCallId ?? '',
        toolName: part.toolName ?? part.type.slice('tool-'.length),
        input: part.input,
        ...(part.output !== undefined ? { output: part.output } : {}),
      });
    }
    // Any other part type (reasoning, source-url, file) has no representation
    // in `Message` and is skipped for rendering. It stays in the stored row.
  }

  return {
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: text.join('\n\n'),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

export function toRenderMessages(messages: unknown): Message[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => toRenderMessage(m as UIMessageLike));
}
