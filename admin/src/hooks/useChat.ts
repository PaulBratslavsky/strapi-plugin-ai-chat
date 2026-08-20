import { useEffect, useMemo, useCallback } from 'react';
import { useChat as useSdkChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { PLUGIN_ID } from '../pluginId';
import { getToken, getBackendURL } from '../utils/auth';

/**
 * Chat state, backed by the AI SDK.
 *
 * The server streams `toUIMessageStreamResponse()` and conversations are
 * persisted as `UIMessage`, so this hook no longer translates between formats —
 * it configures a transport and passes the SDK's own state through.
 *
 * What it replaced hand-parsed three event types (`text-delta`,
 * `tool-input-available`, `tool-output-available`) and silently discarded the
 * rest. `error` was among them, which is why a failed stream surfaced as
 * "No response received." rather than the provider's actual complaint.
 */

/** A tool invocation, as the SDK represents it inside `parts`. */
export interface ToolPart {
  type: string;
  toolCallId: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export type Message = UIMessage;

export interface UseChatOptions {
  initialMessages?: Message[];
  conversationId?: string | null;
  onStreamStart?: () => void;
  enabledToolSources?: string[];
}

/** All text in a message, in order, ignoring tool and other parts. */
export function messageText(message: Message): string {
  return (message.parts ?? [])
    .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('');
}

/** Tool invocations in a message, in the order the model made them. */
export function messageToolParts(message: Message): ToolPart[] {
  return (message.parts ?? []).filter((part: any) =>
    typeof part.type === 'string' && part.type.startsWith('tool-'),
  ) as ToolPart[];
}

/** The tool's name, whether or not the part carries it explicitly. */
export function toolPartName(part: ToolPart): string {
  return part.toolName ?? part.type.slice('tool-'.length);
}

export function useChat(options?: UseChatOptions) {
  const conversationId = options?.conversationId;
  const enabledToolSources = options?.enabledToolSources;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${getBackendURL()}/${PLUGIN_ID}/chat`,
        // Resolved per request rather than captured once. A token refreshed
        // mid-session would otherwise start returning 401s that look like a
        // server fault.
        headers: (): Record<string, string> => {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        body: () => (enabledToolSources ? { enabledToolSources } : {}),
      }),
    [enabledToolSources],
  );

  const chat = useSdkChat({
    transport,
    // Recreates the underlying Chat when the conversation changes, so a
    // switch does not append to the previous conversation's messages.
    id: conversationId ?? 'new',
  });

  const { messages, setMessages, sendMessage: sdkSendMessage, status, error } = chat as any;

  // Seed explicitly rather than through the `messages` option.
  //
  // Conversations arrive asynchronously: the first render has none, and the
  // fetch resolves later. The SDK only reads its `messages` option when it
  // constructs a Chat, so history that arrives after that point is never
  // adopted — the panel rendered the right number of empty bubbles because the
  // messages existed but carried no parts.
  const initialMessages = options?.initialMessages;
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialMessages]);

  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (status === 'streaming') options?.onStreamStart?.();
    // onStreamStart is intentionally not a dependency: callers pass an inline
    // function, which would re-fire this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;
      sdkSendMessage({ text: trimmed });
    },
    [isLoading, sdkSendMessage],
  );

  const clearMessages = useCallback(() => setMessages([]), [setMessages]);

  return {
    messages: messages as Message[],
    setMessages,
    sendMessage,
    clearMessages,
    isLoading,
    // The SDK surfaces a real Error here — including the provider's own
    // message, which the previous implementation dropped on the floor.
    error: error ? (error.message ?? String(error)) : null,
  };
}
