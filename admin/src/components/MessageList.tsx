import { forwardRef, useState, useRef, useEffect, type ComponentProps } from 'react';
import { Box, Typography } from '@strapi/design-system';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkle } from '@strapi/icons';
import type { Message } from '../hooks/useChat';
import { messageText, messageToolParts, toolPartName, messageReasoningText, hasStreamingReasoning } from '../hooks/useChat';
import { ToolCallDisplay, HIDDEN_TOOLS } from './ToolCallDisplay';

// --- Styled Components ---

const MessagesArea = styled.div`
  flex: 1;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const MessageRow = styled.div<{ $isUser: boolean }>`
  display: flex;
  align-items: flex-end;
  gap: 8px;
  align-self: ${({ $isUser }) => ($isUser ? 'flex-end' : 'flex-start')};
  max-width: 80%;
`;

const SparkleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #4945ff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  svg {
    width: 16px;
    height: 16px;
    fill: #ffffff;
  }
`;

const EmptyReplyNote = styled.div`
  font-size: 13px;
  color: #666687;
  font-style: italic;
  line-height: 1.5;

  code {
    font-style: normal;
    background: #eaeaef;
    padding: 1px 4px;
    border-radius: 3px;
  }
`;

const MessageBubble = styled.div<{ $isUser: boolean }>`
  min-width: 0;
  background-color: ${({ $isUser }) => ($isUser ? '#4945ff' : '#f6f6f9')};
  color: ${({ $isUser }) => ($isUser ? '#ffffff' : '#32324d')};
  border-radius: ${({ $isUser }) =>
    $isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};
  padding: 12px 16px;
  font-size: 15px;
  word-break: break-word;
  line-height: 1.6;
`;

const MarkdownBody = styled.div<{ $isUser: boolean }>`
  p { margin: 0 0 8px; &:last-child { margin-bottom: 0; } }
  ul, ol { margin: 4px 0; padding-left: 20px; }
  li { margin: 2px 0; }
  code {
    font-size: 0.85em;
    padding: 1px 4px;
    border-radius: 3px;
    background: ${({ $isUser }) => ($isUser ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)')};
  }
  pre {
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.85em;
    background: ${({ $isUser }) => ($isUser ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.04)')};
    code { padding: 0; background: none; }
  }
  h1, h2, h3, h4 { margin: 12px 0 4px; &:first-child { margin-top: 0; } }
  h1 { font-size: 1.3em; } h2 { font-size: 1.15em; } h3 { font-size: 1.05em; }
  blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid ${({ $isUser }) => ($isUser ? 'rgba(255,255,255,0.3)' : '#dcdce4')};
    opacity: 0.85;
  }
  a { color: ${({ $isUser }) => ($isUser ? '#c0cfff' : '#4945ff')}; }
  table { border-collapse: collapse; margin: 8px 0; font-size: 0.9em; width: 100%; overflow-x: auto; display: block; }
  th, td { border: 1px solid ${({ $isUser }) => ($isUser ? 'rgba(255,255,255,0.2)' : '#dcdce4')}; padding: 4px 8px; text-align: left; white-space: nowrap; }
  th { background: ${({ $isUser }) => ($isUser ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.03)')}; font-weight: 600; }
`;

const MessageRole = styled.div<{ $isUser: boolean }>`
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 4px;
  opacity: 0.7;
  color: ${({ $isUser }) => ($isUser ? '#ffffff' : '#666687')};
`;

const TypingDots = styled.span`
  display: inline-flex;
  gap: 4px;

  span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #a5a5ba;
    animation: bounce 1.4s infinite ease-in-out both;
  }
  span:nth-child(1) { animation-delay: 0s; }
  span:nth-child(2) { animation-delay: 0.2s; }
  span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.4); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }
`;

const ThinkingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 0;
  font-size: 12px;
  color: #666687;
`;

const ThinkingSpinner = styled.span`
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #dcdce4;
  border-top-color: #4945ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

const ReasoningToggle = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 4px;
  font-size: 12px;
  color: #8e8ea9;
  transition: color 0.15s;

  &:hover { color: #666687; }

  &::before {
    content: '';
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid ${({ $open }) => ($open ? 'transparent' : 'currentColor')};
    border-top: 5px solid ${({ $open }) => ($open ? 'currentColor' : 'transparent')};
    border-right: 5px solid transparent;
    border-bottom: 5px solid transparent;
    transition: transform 0.15s;
  }
`;

const ReasoningBox = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: #8e8ea9;
  background: rgba(0,0,0,0.02);
  border-left: 2px solid #dcdce4;
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: 0 4px 4px 0;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const ReasoningStreamDot = styled.span`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4945ff;
  animation: pulse 1s ease-in-out infinite;
  margin-left: 4px;
  vertical-align: middle;

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #a5a5ba;
`;

// --- Content type UID auto-linking ---

const CONTENT_TYPE_UID_RE = /\b(api::\w[\w-]*\.\w[\w-]*)\b/g;

function autoLinkContentTypeUids(text: string): string {
  return text.replace(
    CONTENT_TYPE_UID_RE,
    (match) =>
      `[${match}](/content-manager/collection-types/${match})`
  );
}

function isInternalPath(href: string): boolean {
  return href.startsWith('/content-manager/');
}

function MarkdownLink({
  href,
  children,
  ...props
}: ComponentProps<'a'>) {
  if (href && isInternalPath(href)) {
    return (
      <Link to={href} {...(props as any)}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}

const markdownComponents = {
  a: MarkdownLink,
} as ComponentProps<typeof Markdown>['components'];

// --- Reasoning Display ---

function ReasoningDisplay({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(isStreaming);
  const boxRef = useRef<HTMLDivElement>(null);

  // Auto-open when reasoning starts streaming
  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  // Auto-scroll the reasoning box while streaming
  useEffect(() => {
    if (isStreaming && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  });

  if (!text) return null;

  const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;

  return (
    <>
      <ReasoningToggle $open={open} onClick={() => setOpen((v) => !v)}>
        {isStreaming ? (
          <>Thinking<ReasoningStreamDot /></>
        ) : (
          <>Thought for a moment</>
        )}
        {!open && <span style={{ opacity: 0.6 }}> — {preview}</span>}
      </ReasoningToggle>
      {open && <ReasoningBox ref={boxRef}>{text}</ReasoningBox>}
    </>
  );
}

// --- Component ---

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(
  function MessageList({ messages, isLoading }, ref) {
    return (
      <MessagesArea>
        {messages.length === 0 && (
          <EmptyState>
            <Typography variant="beta" textColor="neutral400">
              AI Chat
            </Typography>
            <Box paddingTop={2}>
              <Typography variant="omega" textColor="neutral500">
                Send a message to start the conversation
              </Typography>
            </Box>
          </EmptyState>
        )}

        {messages.map((message, index) => {
          // Text and tool calls come out of the ordered `parts` array now.
          // Several text parts around a tool call still collapse into one
          // bubble here; the order is preserved in the data, so rendering them
          // interleaved is a later change rather than a lost one.
          const text = messageText(message);
          const reasoning = messageReasoningText(message);
          const isReasoning = hasStreamingReasoning(message);
          const toolParts = messageToolParts(message).map((part) => ({
            ...part,
            toolName: toolPartName(part),
          }));

          const displayContent =
            message.role === 'assistant' && text ? autoLinkContentTypeUids(text) : text;

          const isLastMessage = index === messages.length - 1;
          const hasToolsRunning = toolParts.some((part) => part.output === undefined);
          const showThinking = isLoading && isLastMessage && message.role === 'assistant' && displayContent && hasToolsRunning;

          return (
            <MessageRow key={message.id} $isUser={message.role === 'user'}>
              {message.role === 'assistant' && (
                <SparkleIcon><Sparkle /></SparkleIcon>
              )}
              <MessageBubble $isUser={message.role === 'user'}>
                <MessageRole $isUser={message.role === 'user'}>
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </MessageRole>
                {message.role === 'user' && text}
                {message.role === 'assistant' && reasoning && (
                  <ReasoningDisplay text={reasoning} isStreaming={isReasoning} />
                )}
                {message.role === 'assistant' && !displayContent && !reasoning && isLoading && (
                  <TypingDots><span /><span /><span /></TypingDots>
                )}
                {message.role === 'assistant' && displayContent && (
                  <MarkdownBody $isUser={false}>
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{displayContent}</Markdown>
                  </MarkdownBody>
                )}
                {/*
                  A finished assistant turn with tool calls but no text. The model
                  used its tools and stopped without writing a reply, usually by
                  exhausting `maxSteps` mid-loop. Rendering nothing leaves an empty
                  bubble and no way to tell that from a silent failure.
                */}
                {message.role === 'assistant' && !displayContent && !isLoading && toolParts.length > 0 && (
                  <EmptyReplyNote>
                    The model used its tools but stopped without writing a reply.
                    It likely hit the step limit; raising <code>maxSteps</code> or{' '}
                    <code>maxOutputTokens</code> usually resolves it.
                  </EmptyReplyNote>
                )}
                {toolParts
                  .filter((part) => !HIDDEN_TOOLS.has(part.toolName))
                  .map((part) => (
                    <ToolCallDisplay key={part.toolCallId} toolCall={part} />
                  ))}
                {showThinking && (
                  <ThinkingIndicator>
                    <ThinkingSpinner />
                    Working on it…
                  </ThinkingIndicator>
                )}
              </MessageBubble>
            </MessageRow>
          );
        })}

        <div ref={ref} />
      </MessagesArea>
    );
  }
);
