import { useState, useEffect, useCallback } from 'react';
import type { Message } from './useChat';
import { messageText } from './useChat';
import {
  fetchConversations,
  fetchConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  type ConversationSummary,
} from '../utils/conversations-api';

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);

  // Load conversation list on mount and auto-select the most recent
  useEffect(() => {
    fetchConversations()
      .then(async (list) => {
        setConversations(list);
        if (list.length > 0) {
          const most_recent = list[0];
          const conversation = await fetchConversation(most_recent.documentId);
          setActiveId(most_recent.documentId);
          setInitialMessages((conversation.messages as Message[]) ?? []);
        }
      })
      .catch((err) => console.error('Failed to load conversations:', err));
  }, []);

  const selectConversation = useCallback(async (documentId: string) => {
    try {
      const conversation = await fetchConversation(documentId);
      setActiveId(documentId);
      setInitialMessages((conversation.messages as Message[]) ?? []);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setActiveId(null);
    setInitialMessages([]);
  }, []);

  const saveMessages = useCallback(
    async (messages: Message[]) => {
      if (messages.length === 0) return;

      const firstUserMsg = messages.find((m) => m.role === 'user');
      const firstText = firstUserMsg ? messageText(firstUserMsg) : '';
      const title = firstText
        ? firstText.slice(0, 80) + (firstText.length > 80 ? '…' : '')
        : 'New conversation';

      try {
        if (activeId) {
          await updateConversation(activeId, { title, messages });
          setConversations((prev) =>
            prev.map((c) =>
              c.documentId === activeId ? { ...c, title, updatedAt: new Date().toISOString() } : c
            )
          );
        } else {
          const created = await createConversation({ title, messages });
          setInitialMessages(messages);
          setActiveId(created.documentId);
          setConversations((prev) => [
            {
              documentId: created.documentId,
              title: created.title,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt,
            },
            ...prev,
          ]);
        }
      } catch (err) {
        console.error('Failed to save conversation:', err);
      }
    },
    [activeId]
  );

  const removeConversation = useCallback(
    async (documentId: string) => {
      try {
        await deleteConversation(documentId);
        setConversations((prev) => prev.filter((c) => c.documentId !== documentId));
        if (activeId === documentId) {
          setActiveId(null);
          setInitialMessages([]);
        }
      } catch (err) {
        console.error('Failed to delete conversation:', err);
      }
    },
    [activeId]
  );

  return {
    conversations,
    activeId,
    initialMessages,
    selectConversation,
    startNewConversation,
    saveMessages,
    removeConversation,
  };
}
