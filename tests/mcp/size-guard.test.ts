import { describe, it, expect } from 'vitest';
import { guardSize, MAX_WIRE_BYTES } from '../../server/src/mcp/size-guard';

describe('guardSize', () => {
  it('passes small results through unchanged', () => {
    const result = { items: [1, 2, 3] };
    expect(guardSize(result, 'searchContent')).toBe(result);
  });

  it('replaces oversized results with a structured notice', () => {
    // One char per byte; * 2 for the doubled wire cost puts this over the limit.
    const huge = { blob: 'x'.repeat(MAX_WIRE_BYTES) };
    const guarded = guardSize(huge, 'searchContent') as Record<string, unknown>;

    expect(guarded.error).toBe('RESULT_TOO_LARGE');
    expect(guarded.tool).toBe('searchContent');
    expect(guarded.limitBytes).toBe(MAX_WIRE_BYTES);
    expect(typeof guarded.message).toBe('string');
    expect(guarded.message as string).toContain('pageSize');
  });

  it('accounts for the payload being sent twice', () => {
    // Just over half the limit: fine as one copy, too big when doubled.
    const justOverHalf = { blob: 'x'.repeat(Math.floor(MAX_WIRE_BYTES / 2)) };
    const guarded = guardSize(justOverHalf, 'searchContent') as Record<string, unknown>;
    expect(guarded.error).toBe('RESULT_TOO_LARGE');
  });

  it('handles undefined results without throwing', () => {
    expect(guardSize(undefined, 'someTool')).toBeUndefined();
  });
});
