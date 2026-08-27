/**
 * MCP tool risk tiers — metadata only.
 *
 * Permission gating no longer runs through these tiers: every MCP-exposed
 * tool is now gated by its own admin action (`plugin::ai-chat.tool.<name>`,
 * see `./permissions.ts` and `actionForTool` in there), so an admin token
 * can be scoped to exactly the tools it needs.
 *
 * `access` / `tierFor` stay useful as metadata — for docs, and as a future
 * default when suggesting which tools a new role should grant — but they no
 * longer decide which admin action a tool is gated behind.
 *
 * Tiering runs on two independent axes:
 *  - Mutation: does the tool write/delete data (`write`) or is it purely
 *    irreversible/dangerous (`destructive`)? `read` is the absence of both.
 *  - Cost / external side effect: does the tool spend money, call a paid
 *    external API, or run long enough that a token holder could loop it
 *    indefinitely and rack up real cost or hammer a third party? That is
 *    `maintenance`, and it is orthogonal to mutation — a tool can be
 *    read-only (mutates nothing) and still belong in `maintenance` because
 *    of what it costs to run (e.g. a semantic search that calls an
 *    embeddings API per query).
 *
 * `maintenance` is never derived — a tool lands there only by an explicit
 * `access: 'maintenance'`, because "expensive" isn't inferable from
 * `publicSafe` the way "read-only" is.
 */
export type AccessTier = 'read' | 'write' | 'destructive' | 'maintenance';

/** The subset of ToolDefinition that tiering depends on. */
export interface Tierable {
  access?: AccessTier;
  publicSafe?: boolean;
}

/**
 * Resolve a tool's tier. An explicit `access` always wins. Otherwise
 * `publicSafe` (which already means "read-only and safe for anonymous
 * chat") implies read, and everything else defaults to write — the safe
 * default for third-party tools that declare neither. `maintenance` is
 * only ever set explicitly and is never part of this derivation.
 *
 * This tier is metadata only — it does not gate MCP access (see the module
 * doc comment above).
 */
export function tierFor(def: Tierable): AccessTier {
  return def.access ?? (def.publicSafe ? 'read' : 'write');
}
