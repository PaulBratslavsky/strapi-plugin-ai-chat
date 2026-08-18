// Custom admin permissions for this plugin's MCP tools.
//
// The official server gates each custom tool behind an `auth.policies` action
// string, and that action must exist in the admin permission registry before a
// token can be granted it. A tool only appears in `tools/list` when the
// connecting token's ability satisfies its policy.
//
// ai-sdk is a plugin, so registration uses `section: 'plugins'` with
// `pluginName`, which yields action ids under the `plugin::ai-sdk.` prefix.
import type { Core } from '@strapi/strapi';

export interface McpActionDef {
  section: 'plugins';
  pluginName: 'ai-sdk';
  uid: string;
  displayName: string;
}

export const MCP_ACTION_DEFS: McpActionDef[] = [
  {
    section: 'plugins',
    pluginName: 'ai-sdk',
    uid: 'mcp.read',
    displayName: 'Use read-only AI SDK MCP tools',
  },
  {
    section: 'plugins',
    pluginName: 'ai-sdk',
    uid: 'mcp.write',
    displayName: 'Use content-mutating AI SDK MCP tools',
  },
  {
    section: 'plugins',
    pluginName: 'ai-sdk',
    uid: 'mcp.destructive',
    displayName: 'Use irreversible / external-side-effect AI SDK MCP tools',
  },
  {
    // Expensive-to-run tools: they call a paid external API per invocation
    // (or otherwise carry real external-side-effect cost) and could be
    // looped indefinitely by a token holder, regardless of whether they
    // mutate anything. Split out so a browse-and-annotate token (read +
    // write) can't trigger them.
    section: 'plugins',
    pluginName: 'ai-sdk',
    uid: 'mcp.maintenance',
    displayName: 'Use expensive / external-API-cost AI SDK MCP tools',
  },
];

export async function registerMcpAdminPermissions(strapi: Core.Strapi): Promise<void> {
  await strapi.service('admin::permission').actionProvider.registerMany(MCP_ACTION_DEFS);
  strapi.log.info(
    `[ai-sdk:mcp] Registered ${MCP_ACTION_DEFS.length} custom admin permission(s).`,
  );
}
