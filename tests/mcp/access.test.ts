import { describe, it, expect } from 'vitest';
import { MCP_ACTIONS, tierFor, actionFor } from '../../server/src/mcp/access';

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
});

describe('actionFor', () => {
  it('maps each tier to its namespaced admin action', () => {
    expect(actionFor({ publicSafe: true })).toBe('plugin::ai-sdk.mcp.read');
    expect(actionFor({})).toBe('plugin::ai-sdk.mcp.write');
    expect(actionFor({ access: 'destructive' })).toBe('plugin::ai-sdk.mcp.destructive');
  });
});

describe('MCP_ACTIONS', () => {
  it('exposes exactly three tiers under the plugin::ai-sdk namespace', () => {
    expect(Object.keys(MCP_ACTIONS).sort()).toEqual(['destructive', 'read', 'write']);
    for (const action of Object.values(MCP_ACTIONS)) {
      expect(action.startsWith('plugin::ai-sdk.mcp.')).toBe(true);
    }
  });
});
