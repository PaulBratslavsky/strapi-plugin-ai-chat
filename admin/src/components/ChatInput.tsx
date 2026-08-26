import { Box, Button, TextInput } from '@strapi/design-system';
import { Sparkle } from '@strapi/icons';
import styled from 'styled-components';

// --- Styled Components ---

const InputArea = styled.div`
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 16px;
  border-top: 1px solid #eaeaef;
`;

const StopIcon = styled.span`
  display: inline-flex;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
`;

// --- Component ---

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  /** Abandon the turn in progress. */
  onStop: () => void;
}

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSend,
  onStop,
}: ChatInputProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <InputArea>
        <Box flex="1">
          <TextInput
            placeholder="Type your message..."
            aria-label="Chat message"
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onInputChange(e.target.value)
            }
          />
        </Box>
        {/*
          Stop replaces Send while a turn is running, rather than sitting
          beside it. A disabled Send with a spinner gives no way out of a turn
          that has stalled — which is the state this button exists for, so it
          has to occupy the place the user is already looking.
        */}
        {isLoading ? (
          <Button
            type="button"
            onClick={onStop}
            variant="tertiary"
            size="L"
            startIcon={<StopIcon />}
          >
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={!input.trim()}
            size="L"
            startIcon={<Sparkle />}
          >
            Send
          </Button>
        )}
      </InputArea>
    </form>
  );
}
