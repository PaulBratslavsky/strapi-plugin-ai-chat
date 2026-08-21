import { describe, it, expect } from 'vitest';
import { describeToolFailure } from '../../server/src/tools';

/**
 * A rejected write is only useful to a model if it says what to change.
 * Strapi reports multi-field failures as a count and hides the causes in
 * `details.errors`, which the AI SDK drops when it serialises the error.
 */
describe('describeToolFailure', () => {
  it('keeps a plain message unchanged', () => {
    expect(describeToolFailure(new Error('boom'))).toBe('boom');
  });

  it('names the field and reason behind a single validation error', () => {
    const error = Object.assign(new Error('description must be at most 80 characters'), {
      details: { errors: [{ path: ['description'], message: 'description must be at most 80 characters' }] },
    });

    expect(describeToolFailure(error)).toContain('description: description must be at most 80 characters');
  });

  it('expands the count that Strapi reports for a multi-field failure', () => {
    const error = Object.assign(new Error('3 errors occurred'), {
      details: {
        errors: [
          { path: ['description'], message: 'must be at most 80 characters' },
          { path: ['slug'], message: 'must be unique' },
          { path: ['blocks', '0', 'body'], message: 'must be a string' },
        ],
      },
    });

    const described = describeToolFailure(error);
    expect(described).toContain('description: must be at most 80 characters');
    expect(described).toContain('slug: must be unique');
    expect(described).toContain('blocks.0.body: must be a string');
  });

  it('reads details nested under `error`, which is how some layers wrap them', () => {
    const error = { message: 'ValidationError', error: { details: { errors: [{ path: ['title'], message: 'required' }] } } };
    expect(describeToolFailure(error)).toContain('title: required');
  });

  it('falls back to the message when details carry nothing usable', () => {
    const error = Object.assign(new Error('2 errors occurred'), { details: { errors: [] } });
    expect(describeToolFailure(error)).toBe('2 errors occurred');
  });

  it('survives a non-Error being thrown', () => {
    expect(describeToolFailure('just a string')).toBe('just a string');
  });
});
