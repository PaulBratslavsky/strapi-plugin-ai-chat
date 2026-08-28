import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToolCallDisplay } from '../../admin/src/components/ToolCallDisplay';

/**
 * These exist because of a bug that shipped: a failed tool call rendered a
 * spinner and "Waiting for result..." forever.
 *
 * The component decided between pending and complete by reading `output`
 * alone. The SDK reports a failure as state 'output-error' with errorText and
 * leaves output undefined, so "no output" was read as "still running". Nothing
 * in the unit suite could see it, because the fault was only ever visible on
 * screen.
 */

const show = (toolCall: any) =>
  render(
    <MemoryRouter>
      <ToolCallDisplay toolCall={toolCall} />
    </MemoryRouter>,
  );

const base = { type: 'tool-fetchTranscript', toolCallId: 'c1', toolName: 'fetchTranscript' };

describe('ToolCallDisplay', () => {
  it('shows a running call as running', () => {
    show({ ...base, state: 'input-available', input: { videoId: 'x' } });

    expect(screen.getByText(/Tool: fetchTranscript/)).toBeInTheDocument();
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
  });

  it('shows a completed call as completed', () => {
    show({ ...base, state: 'output-available', output: { ok: true } });

    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
  });

  it('shows a failed call as failed, not as running', () => {
    // The regression this file exists for.
    show({ ...base, state: 'output-error', errorText: 'YouTube returned 502' });

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
  });

  it('never leaves a failed call claiming to be waiting', () => {
    const { container } = show({
      ...base,
      state: 'output-error',
      errorText: 'YouTube returned 502',
    });

    expect(container.textContent).not.toMatch(/Waiting for result/i);
  });

  it('says why it failed rather than showing an empty body', () => {
    show({ ...base, state: 'output-error', errorText: 'YouTube returned 502' });

    // React does not see a raw DOM click; fireEvent dispatches what it listens for.
    fireEvent.click(screen.getByText(/Tool: fetchTranscript/).closest('button')!);

    expect(screen.getByText(/YouTube returned 502/)).toBeInTheDocument();
  });

  it('falls back to a readable line when a failure carries no reason', () => {
    show({ ...base, state: 'output-error' });

    fireEvent.click(screen.getByText(/Tool: fetchTranscript/).closest('button')!);

    expect(screen.getByText(/failed without reporting a reason/i)).toBeInTheDocument();
  });
});
