import { describe, it, expect } from 'vitest';
import { builtInTools } from '../../server/src/tools/definitions';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import { tierFor } from '../../server/src/mcp/access';
import { toSnakeCase } from '../../server/src/mcp/naming';

/**
 * Table-driven inventory test over the REAL `builtInTools` array (not
 * synthetic fixtures). This is the regression test for the incident where
 * `yt-transcripts`' `fetchTranscript` shipped `publicSafe: true` with no
 * `access` field and silently landed in the read-only MCP tier despite
 * writing to the database. Every existing tests/mcp/*.test.ts file exercises
 * `tierFor`/`registerToolsOnMcp` against hand-built fixtures, so a mistake
 * like that one can ship with a fully green suite.
 *
 * Pin the full expected inventory explicitly: adding, removing, or
 * re-tiering a built-in tool must force a deliberate update here.
 */
const EXPECTED_INVENTORY: Array<{
  name: string;
  mcpName: string;
  tier: 'read' | 'write' | 'destructive' | 'maintenance';
  internal: boolean;
}> = [
  { name: 'listContentTypes', mcpName: 'list_content_types', tier: 'read', internal: false },
  { name: 'searchContent', mcpName: 'search_content', tier: 'read', internal: false },
  { name: 'createContent', mcpName: 'create_content', tier: 'write', internal: false },
  { name: 'updateContent', mcpName: 'update_content', tier: 'write', internal: false },
  { name: 'findOneContent', mcpName: 'find_one_content', tier: 'read', internal: false },
  { name: 'uploadMedia', mcpName: 'upload_media', tier: 'write', internal: false },
  { name: 'sendEmail', mcpName: 'send_email', tier: 'destructive', internal: false },
  { name: 'saveMemory', mcpName: 'save_memory', tier: 'write', internal: true },
  { name: 'recallMemories', mcpName: 'recall_memories', tier: 'write', internal: true },
  { name: 'recallPublicMemories', mcpName: 'recall_public_memories', tier: 'read', internal: true },
  { name: 'aggregateContent', mcpName: 'aggregate_content', tier: 'read', internal: false },
  { name: 'manageTask', mcpName: 'manage_task', tier: 'write', internal: true },
  { name: 'saveNote', mcpName: 'save_note', tier: 'write', internal: true },
  { name: 'recallNotes', mcpName: 'recall_notes', tier: 'write', internal: true },
];

describe('builtInTools inventory', () => {
  it('has exactly the expected set of tool names', () => {
    const actualNames = builtInTools.map((def) => def.name).sort();
    const expectedNames = EXPECTED_INVENTORY.map((row) => row.name).sort();
    expect(actualNames).toEqual(expectedNames);
  });

  it.each(EXPECTED_INVENTORY)(
    '$name -> MCP name "$mcpName", tier "$tier", internal=$internal',
    ({ name, mcpName, tier, internal }) => {
      const def = builtInTools.find((d) => d.name === name);
      expect(def, `expected a built-in tool named "${name}"`).toBeDefined();
      expect(toSnakeCase(def!.name)).toBe(mcpName);
      expect(tierFor(def!)).toBe(tier);
      expect(!!def!.internal).toBe(internal);
    },
  );

  it('exposes exactly the read-tier tools via MCP', () => {
    const readNames = EXPECTED_INVENTORY.filter((row) => row.tier === 'read' && !row.internal).map(
      (row) => row.name,
    );
    expect(readNames.sort()).toEqual(
      ['listContentTypes', 'searchContent', 'findOneContent', 'aggregateContent'].sort(),
    );
  });

  it('exposes exactly the write-tier tools via MCP', () => {
    const writeNames = EXPECTED_INVENTORY.filter((row) => row.tier === 'write' && !row.internal).map(
      (row) => row.name,
    );
    expect(writeNames.sort()).toEqual(['createContent', 'updateContent', 'uploadMedia'].sort());
  });

  it('exposes exactly the destructive-tier tools via MCP', () => {
    const destructiveNames = EXPECTED_INVENTORY.filter(
      (row) => row.tier === 'destructive' && !row.internal,
    ).map((row) => row.name);
    expect(destructiveNames).toEqual(['sendEmail']);
  });

  it('exposes exactly the maintenance-tier tools via MCP', () => {
    // None of the hub's built-ins call a paid external API per invocation
    // today; this stays empty until one does. yt-transcripts' fetchTranscript
    // and yt-embeddings' searchYtKnowledge are maintenance-tier, but those
    // live in their own plugin packages, not builtInTools.
    const maintenanceNames = EXPECTED_INVENTORY.filter(
      (row) => row.tier === 'maintenance' && !row.internal,
    ).map((row) => row.name);
    expect(maintenanceNames).toEqual([]);
  });

  it('keeps exactly 6 tools internal (chat-only, absent from MCP)', () => {
    const internalNames = EXPECTED_INVENTORY.filter((row) => row.internal).map((row) => row.name);
    expect(internalNames).toHaveLength(6);
  });

  it('excludes every internal tool from registry.getPublic()', () => {
    const registry = new ToolRegistry();
    for (const def of builtInTools) registry.register(def);

    const publicNames = new Set(registry.getPublic().keys());
    const internalNames = EXPECTED_INVENTORY.filter((row) => row.internal).map((row) => row.name);

    expect(internalNames).toHaveLength(6);
    for (const name of internalNames) {
      expect(publicNames.has(name)).toBe(false);
    }
    for (const row of EXPECTED_INVENTORY.filter((r) => !r.internal)) {
      expect(publicNames.has(row.name)).toBe(true);
    }
  });
});
