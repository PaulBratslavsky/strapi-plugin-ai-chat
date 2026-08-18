/**
 * MCP permission tiers.
 *
 * The official Strapi MCP server gates every custom tool behind an admin
 * permission action. A tool's tier decides which action guards it, and
 * because permission gating also filters `tools/list`, a read-scoped token
 * yields a genuinely browse-only surface.
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

export const MCP_ACTIONS: Record<AccessTier, string> = {
  read: 'plugin::ai-sdk.mcp.read',
  write: 'plugin::ai-sdk.mcp.write',
  destructive: 'plugin::ai-sdk.mcp.destructive',
  maintenance: 'plugin::ai-sdk.mcp.maintenance',
};

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
 */
export function tierFor(def: Tierable): AccessTier {
  return def.access ?? (def.publicSafe ? 'read' : 'write');
}

export function actionFor(def: Tierable): string {
  return MCP_ACTIONS[tierFor(def)];
}
