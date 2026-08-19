// Custom admin permissions for this plugin's MCP tools.
//
// The official server gates each custom tool behind an `auth.policies` action
// string, and that action must exist in the admin permission registry before a
// token can be granted it. A tool only appears in `tools/list` when the
// connecting token's ability satisfies its policy.
//
// One action is registered per MCP-exposed tool (uid `tool.<action-slug>`,
// e.g. `tool.fetch-transcript` — see `toActionSlug` in ./naming, which
// swaps underscores for hyphens because Strapi's admin action uid validator
// only accepts lowercase letters, dots, and hyphens), so an admin token can
// be scoped to exactly the tools it needs — instead of the old four-tier
// scheme (`mcp.read`/`mcp.write`/`mcp.destructive`/`mcp.maintenance`), which
// showed four checkboxes in the admin grid that didn't correspond to any
// tool the user could see.
//
// Each action is registered under `section: 'plugins'` with `pluginName` set
// to the plugin that OWNS the tool — not always ai-sdk. Built-in tools use
// `pluginName: 'ai-sdk'`; a tool contributed by another plugin (namespaced
// `<source>__<toolName>` during discovery, see bootstrap.ts) uses that
// source as its `pluginName`, so its permission shows up in that plugin's
// own section of the admin permissions screen — e.g.
// `plugin::ai-sdk-yt-transcripts.tool.fetch-transcript`, not
// `plugin::ai-sdk.tool.ai-sdk-yt-transcripts__fetch-transcript`. This keeps
// the ai-sdk section lean: it lists only the tools it actually owns.
import type { Core } from '@strapi/strapi';
import type { ToolRegistry } from '../lib/tool-registry';
import { toActionSlug, toDisplayName, getToolSource } from './naming';

export interface McpActionDef {
  section: 'plugins';
  pluginName: string;
  subCategory: string;
  uid: string;
  displayName: string;
}

/**
 * Every tool's section is already its own plugin, so subCategory doesn't
 * need to carry a source label the way it would if everything lived under
 * one plugin — this is just a stable, readable group name within each
 * plugin's section.
 */
const SUBCATEGORY = 'MCP tools';

const AI_SDK_PLUGIN_NAME = 'ai-sdk';

/** The tool-guide MCP resource gets its own action, alongside real tools. */
const TOOL_GUIDE_ACTION_DEF: McpActionDef = {
  section: 'plugins',
  pluginName: AI_SDK_PLUGIN_NAME,
  subCategory: SUBCATEGORY,
  uid: 'tool.guide',
  displayName: 'Read the tool guide',
};

export const TOOL_GUIDE_ACTION = 'plugin::ai-sdk.tool.guide';

/** The plugin name a registry tool's permission is registered under. */
function pluginNameForTool(name: string): string {
  const source = getToolSource(name);
  return source === 'built-in' ? AI_SDK_PLUGIN_NAME : source;
}

/**
 * Build one admin action definition per public tool in the registry, plus
 * one for the tool-guide resource. Generated from the registry (the same set
 * `register-tools.ts` iterates via `getPublic()`) so a tool and its
 * permission can never drift apart.
 */
export function buildMcpActionDefs(registry: ToolRegistry): McpActionDef[] {
  const defs: McpActionDef[] = [TOOL_GUIDE_ACTION_DEF];

  for (const [name] of registry.getPublic()) {
    defs.push({
      section: 'plugins',
      pluginName: pluginNameForTool(name),
      subCategory: SUBCATEGORY,
      uid: `tool.${toActionSlug(name)}`,
      displayName: toDisplayName(name),
    });
  }

  return defs;
}

/** The action id a given registry tool name is gated behind. */
export function actionForTool(name: string): string {
  return `plugin::${pluginNameForTool(name)}.tool.${toActionSlug(name)}`;
}

/**
 * Warn when nothing grants any of our tool actions.
 *
 * Registering actions and granting them are different things: Strapi filters
 * `tools/list` per caller, so a token holding none of these actions gets a
 * successful but *empty* tool list — no error, and the registration logs above
 * still read as success. That is exactly the state an upgrade lands in, since
 * Strapi prunes permission rows whose action id no longer exists (the pre-1.2.0
 * `plugin::ai-sdk.mcp.*` tiers). Without this warning the only symptom is a
 * client that mysteriously sees no tools.
 *
 * Advisory only — never throws, never blocks boot.
 */
async function warnIfNothingGranted(strapi: Core.Strapi, actionIds: string[]): Promise<void> {
  if (actionIds.length === 0) return;

  try {
    const where = { action: { $in: actionIds } };
    const [roleGrants, tokenGrants] = await Promise.all([
      strapi.db.query('admin::permission').count({ where }),
      strapi.db.query('admin::api-token-permission').count({ where }),
    ]);

    if (roleGrants === 0 && tokenGrants === 0) {
      strapi.log.warn(
        `[ai-sdk:mcp] ${actionIds.length} tool permission(s) registered, but no role or API ` +
          `token grants any of them. MCP clients will authenticate successfully and receive an ` +
          `EMPTY tools/list, and in-Strapi chat will have no tools. Grant them under each ` +
          `plugin's section in Settings > Roles (for chat) or Settings > API Tokens (for MCP). ` +
          `If you upgraded from a version using plugin::ai-sdk.mcp.read/.write/.destructive/` +
          `.maintenance, those actions no longer exist and their grants were pruned — the tools ` +
          `must be re-granted individually.`,
      );
    }
  } catch (error) {
    // A failed advisory check must never affect boot.
    strapi.log.debug(
      `[ai-sdk:mcp] Could not check whether tool permissions are granted: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function registerMcpAdminPermissions(
  strapi: Core.Strapi,
  registry: ToolRegistry,
): Promise<void> {
  const defs = buildMcpActionDefs(registry);
  await strapi.service('admin::permission').actionProvider.registerMany(defs);
  strapi.log.info(`[ai-sdk:mcp] Registered ${defs.length} custom admin permission(s).`);

  await warnIfNothingGranted(
    strapi,
    defs.map((d) => `plugin::${d.pluginName}.${d.uid}`),
  );
}
