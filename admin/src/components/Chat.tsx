import { useState, useRef, useEffect, useMemo } from 'react';
import { Box, Typography } from '@strapi/design-system';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useChat } from '../hooks/useChat';
import { useConversations } from '../hooks/useConversations';
import { useMemories } from '../hooks/useMemories';
import { useNotes } from '../hooks/useNotes';
import { useToolSources } from '../hooks/useToolSources';
import { PLUGIN_ID } from '../pluginId';
import { ContextBadge } from './ContextBadge';
import { ConversationSidebar } from './ConversationSidebar';
import { MemoryPanel } from './MemoryPanel';
import { NotePanel } from './NotePanel';
import { ToolSourcePicker } from './ToolSourcePicker';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

// --- Styled Components ---

const ChatLayout = styled.div`
  display: flex;
  flex-direction: row;
  height: calc(100vh - 200px);
  min-height: 400px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(33, 33, 52, 0.1);
  background: #ffffff;
`;

const ChatWrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const ToggleSidebarBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #dcdce4;
  border-radius: 4px;
  background: #ffffff;
  color: #666687;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: #f0f0f5;
    color: #4945ff;
    border-color: #4945ff;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const ChatTopBar = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #eaeaef;
  gap: 8px;
`;

// --- Component ---

export function Chat() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevIsLoadingRef = useRef(false);
  const {
    conversations,
    activeId,
    initialMessages,
    selectConversation,
    startNewConversation,
    saveMessages,
    removeConversation,
  } = useConversations();
  const { memories, removeMemory, refresh: refreshMemories } = useMemories();
  const { notes, removeNote, editNote, refresh: refreshNotes } = useNotes();
  const { sources, enabledSources, enabledToolSources, toggleSource } = useToolSources();
  const { messages, sendMessage, isLoading, error } = useChat({
    initialMessages,
    conversationId: activeId,
    enabledToolSources,
  });

  // Auto-save when assistant response completes (isLoading transitions true -> false)
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading && messages.length > 0) {
      saveMessages(messages);
      refreshMemories();
      refreshNotes();
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, messages, saveMessages, refreshMemories, refreshNotes]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput('');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Token usage the server attached to the most recent answered turn. Read
  // backwards because only assistant messages carry it, and a turn still
  // streaming has none yet.
  const lastUsage = useMemo<number | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const total = (messages[i] as any)?.metadata?.usage?.totalTokens;
      if (typeof total === 'number') return total;
    }
    return null;
  }, [messages]);

  return (
    <ChatLayout>
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onSelect={selectConversation}
        onNew={startNewConversation}
        onDelete={removeConversation}
      />
      <ChatWrapper>
        <ChatTopBar>
          <ToggleSidebarBtn
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? 'Hide conversations' : 'Show conversations'}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="1" y="2" width="14" height="12" rx="1.5" />
              <line x1="5.5" y1="2" x2="5.5" y2="14" />
            </svg>
          </ToggleSidebarBtn>
          <ToggleSidebarBtn
            onClick={() => navigate(`/plugins/${PLUGIN_ID}/memory-store`)}
            aria-label="Memory Store"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M2 8h12M2 12h8" />
            </svg>
          </ToggleSidebarBtn>
          <ToggleSidebarBtn
            onClick={() => navigate(`/plugins/${PLUGIN_ID}/note-store`)}
            aria-label="Research Notes"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 2v12h8V5l-3-3H4z" />
              <path d="M9 2v3h3" />
              <path d="M6 8h4M6 10.5h4" />
            </svg>
          </ToggleSidebarBtn>
          <ToggleSidebarBtn
            onClick={() => navigate(`/plugins/${PLUGIN_ID}/public-memory-store`)}
            aria-label="Shared Memory Store"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8" cy="8" r="6" />
              <ellipse cx="8" cy="8" rx="2.5" ry="6" />
              <path d="M2 8h12" />
            </svg>
          </ToggleSidebarBtn>
          <ToolSourcePicker
            sources={sources}
            enabledSources={enabledSources}
            onToggle={toggleSource}
          />
          <div style={{ flex: 1 }} />
          <ContextBadge used={lastUsage} />
          <ToggleSidebarBtn
            onClick={() => setNotePanelOpen((prev) => !prev)}
            aria-label={notePanelOpen ? 'Hide notes' : 'Show notes'}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 2v12h8V5l-3-3H4z" />
              <path d="M9 2v3h3" />
              <path d="M6 8h4M6 10.5h4" />
            </svg>
          </ToggleSidebarBtn>
          <ToggleSidebarBtn
            onClick={() => setMemoryPanelOpen((prev) => !prev)}
            aria-label={memoryPanelOpen ? 'Hide memories' : 'Show memories'}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8" cy="6" r="4" />
              <path d="M4 10.5C4 10.5 5 14 8 14s4-3.5 4-3.5" />
            </svg>
          </ToggleSidebarBtn>
        </ChatTopBar>
        <MessageList
          ref={messagesEndRef}
          messages={messages}
          isLoading={isLoading}
        />

        {error && (
          <Box padding={3} background="danger100" marginLeft={4} marginRight={4}>
            <Typography textColor="danger600">Error: {error}</Typography>
          </Box>
        )}

        <ChatInput
          input={input}
          isLoading={isLoading}
          onInputChange={setInput}
          onSend={handleSend}
        />
      </ChatWrapper>
      <NotePanel
        notes={notes}
        open={notePanelOpen}
        onDelete={removeNote}
        onEdit={editNote}
      />
      <MemoryPanel
        memories={memories}
        open={memoryPanelOpen}
        onDelete={removeMemory}
      />
    </ChatLayout>
  );
}
