import { describe, it, expect } from 'vitest';
import { tierFor } from '../../server/src/mcp/access';

describe('tierFor', () => {
  it('defaults to write when nothing is declared', () => {
    expect(tierFor({})).toBe('write');
  });

  it('derives read from publicSafe', () => {
    expect(tierFor({ publicSafe: true })).toBe('read');
  });

  it('prefers an explicit access field over publicSafe', () => {
    expect(tierFor({ publicSafe: true, access: 'destructive' })).toBe('destructive');
    expect(tierFor({ publicSafe: false, access: 'read' })).toBe('read');
  });

  it('never derives maintenance — only an explicit access field sets it', () => {
    expect(tierFor({ publicSafe: true, access: 'maintenance' })).toBe('maintenance');
    expect(tierFor({ publicSafe: true })).not.toBe('maintenance');
    expect(tierFor({})).not.toBe('maintenance');
  });
});
