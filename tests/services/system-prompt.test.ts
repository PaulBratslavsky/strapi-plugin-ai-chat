import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '../../server/src/services/service';

const TOOLS = 'Available tools:\n- createContent: Create a document';

/**
 * A configured `systemPrompt` replaces the shipped preamble entirely, which is
 * correct for tone and role and wrong for the rules that keep a tool loop
 * honest. Those are appended instead, so no configuration can drop them.
 */
describe('composeSystemPrompt', () => {
  it('appends the tool rules when the site configures its own prompt', () => {
    const prompt = composeSystemPrompt({ systemPrompt: 'You are terse.' } as any, TOOLS);

    expect(prompt).toContain('You are terse.');
    expect(prompt).toContain('Tool use rules');
    expect(prompt).toMatch(/Never say you created/i);
  });

  it('appends them to the default preamble too', () => {
    expect(composeSystemPrompt(undefined, TOOLS)).toContain('Tool use rules');
  });

  it('appends them when an explicit override is passed', () => {
    const prompt = composeSystemPrompt({ systemPrompt: 'ignored' } as any, TOOLS, 'Override.');

    expect(prompt).toContain('Override.');
    expect(prompt).not.toContain('ignored');
    expect(prompt).toContain('Tool use rules');
  });

  it('keeps the rules when a {tools} placeholder is used', () => {
    const prompt = composeSystemPrompt({ systemPrompt: 'Base {tools} end.' } as any, TOOLS);

    expect(prompt).toContain('createContent');
    expect(prompt).not.toContain('{tools}');
    expect(prompt).toContain('Tool use rules');
  });

  it('still includes the tool descriptions alongside the rules', () => {
    expect(composeSystemPrompt(undefined, TOOLS)).toContain('Available tools:');
  });
});
