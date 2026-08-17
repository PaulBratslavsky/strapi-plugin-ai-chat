/**
 * MCP permission tiers.
 *
 * The official Strapi MCP server gates every custom tool behind an admin
 * permission action. A tool's tier decides which action guards it, and
 * because permission gating also filters `tools/list`, a read-scoped token
 * yields a genuinely browse-only surface.
 */
export type AccessTier = 'read' | 'write' | 'destructive';

export const MCP_ACTIONS: Record<AccessTier, string> = {
  read: 'plugin::ai-sdk.mcp.read',
  write: 'plugin::ai-sdk.mcp.write',
  destructive: 'plugin::ai-sdk.mcp.destructive',
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
 * default for third-party tools that declare neither.
 */
export function tierFor(def: Tierable): AccessTier {
  return def.access ?? (def.publicSafe ? 'read' : 'write');
}

export function actionFor(def: Tierable): string {
  return MCP_ACTIONS[tierFor(def)];
}
