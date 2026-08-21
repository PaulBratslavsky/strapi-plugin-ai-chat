import { describe, it, expect } from 'vitest';
import { isServed, normalizeModelTag } from '../../server/src/lib/model-tag';

/**
 * Ollama treats a bare name as implicitly `:latest`, so an exact comparison
 * reports a working model as missing. That is worse than staying silent: the
 * badge accuses the one part of the setup that is fine.
 */
describe('isServed', () => {
  const ollama = ['qwen3-14b-32k:latest', 'qwen3:14b', 'gemma4-kb:latest', 'llama3.2:3b'];

  it('matches a bare config name against an implicitly tagged model', () => {
    expect(isServed('qwen3-14b-32k', ollama)).toBe(true);
  });

  it('matches when the config carries the tag and the endpoint does not', () => {
    expect(isServed('qwen3:14b:latest', ['qwen3:14b'])).toBe(true);
  });

  it('matches an exact id', () => {
    expect(isServed('llama3.2:3b', ollama)).toBe(true);
  });

  it('still reports a genuinely absent model', () => {
    expect(isServed('mistral-small', ollama)).toBe(false);
  });

  it('does not confuse models sharing a prefix', () => {
    expect(isServed('qwen3', ollama)).toBe(false);
  });

  it('handles an empty served list', () => {
    expect(isServed('anything', [])).toBe(false);
  });
});

describe('normalizeModelTag', () => {
  it('strips only a trailing :latest', () => {
    expect(normalizeModelTag('gemma4-kb:latest')).toBe('gemma4-kb');
  });

  it('leaves a meaningful tag alone', () => {
    expect(normalizeModelTag('qwen3:14b')).toBe('qwen3:14b');
  });
});
