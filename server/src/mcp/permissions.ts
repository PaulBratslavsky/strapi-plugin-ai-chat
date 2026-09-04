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
// We register only the tools we own. Every action lands under
// `section: 'plugins'` with `pluginName: 'ai-chat'`.
//
// A tool contributed by another plugin (namespaced `<source>__<toolName>`
// during discovery, see bootstrap.ts) is that plugin's to register, in its own
// bootstrap, under its own id — e.g.
// `plugin::youtube-transcripts.tool.fetch-transcript`. That is the same id
// this file used to generate, so enforcement and existing grants are
// unaffected; what changes is who declares it.
//
// The reason it moved: a contributing plugin has to work installed on its own.
// While this file declared those actions, a plugin without ai-chat alongside it
// had nothing in Settings > Roles at all, and even with ai-chat the actions
// only existed when the MCP server happened to be enabled, since this whole
// pass sits behind that check.
//
// Both sides registering is not an option: the admin action provider is built
// with the default `throwOnDuplicates`, so the second one throws
// `Duplicated item key`, and our caller catches that and abandons the rest of
// the pass — leaving the MCP server with no tools at all.
import type { Core } from '@strapi/strapi';
import type { ToolRegistry } from '../lib/tool-registry';
import { toActionSlug, toDisplayName } from './naming';
import { actionForTool, pluginNameForTool, AI_SDK_PLUGIN_NAME } from '../lib/tool-permissions';

export { actionForTool };

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
// Grouping label in the permissions grid. Deliberately not "MCP tools":
// these same actions gate in-Strapi chat when granted on a role, so naming
// them after MCP misleads anyone editing a role.
const SUBCATEGORY = 'AI tools';

/** The tool-guide MCP resource gets its own action, alongside real tools. */
const TOOL_GUIDE_ACTION_DEF: McpActionDef = {
  section: 'plugins',
  pluginName: AI_SDK_PLUGIN_NAME,
  subCategory: SUBCATEGORY,
  uid: 'tool.guide',
  displayName: 'Read the tool guide',
};

export const TOOL_GUIDE_ACTION = 'plugin::ai-chat.tool.guide';

/**
 * Build one admin action definition per public tool in the registry, plus
 * one for the tool-guide resource. Generated from the registry (the same set
 * `register-tools.ts` iterates via `getPublic()`) so a tool and its
 * permission can never drift apart.
 */
export function buildMcpActionDefs(registry: ToolRegistry): McpActionDef[] {
  const defs: McpActionDef[] = [TOOL_GUIDE_ACTION_DEF];

  for (const [name] of registry.getPublic()) {
    // Only our own tools. A tool contributed by another plugin is that
    // plugin's to register, in its own bootstrap, so it works standalone
    // without this one installed. Registering it here as well would throw
    // `Duplicated item key` (the admin action provider is built with the
    // default throwOnDuplicates), and the caller catches that and abandons
    // the rest of the pass, leaving the MCP server with no tools at all.
    if (pluginNameForTool(name) !== AI_SDK_PLUGIN_NAME) continue;

    defs.push({
      section: 'plugins',
      pluginName: AI_SDK_PLUGIN_NAME,
      subCategory: SUBCATEGORY,
      uid: `tool.${toActionSlug(name)}`,
      displayName: toDisplayName(name),
    });
  }

  return defs;
}

/**
 * Say something when a contributed tool has no action registered by anyone.
 *
 * We deliberately no longer register these, so a plugin that has not adopted
 * the convention ends up with tools nobody gated. That matters more than it
 * sounds: Strapi's `cleanPermissionsInDatabase` deletes grant rows whose
 * action id no longer exists, so the symptom is silently revoked access on
 * the next boot rather than an error. Advisory only.
 */
function warnAboutUnownedTools(strapi: Core.Strapi, registry: ToolRegistry): void {
  const provider = strapi.service('admin::permission').actionProvider;
  const orphans = new Map<string, string[]>();

  for (const [name] of registry.getPublic()) {
    const owner = pluginNameForTool(name);
    if (owner === AI_SDK_PLUGIN_NAME) continue;

    const id = actionForTool(name);
    if (provider.has?.(id)) continue;

    const list = orphans.get(owner) ?? [];
    list.push(id);
    orphans.set(owner, list);
  }

  for (const [owner, ids] of orphans) {
    strapi.log.warn(
      `[ai-chat:mcp] ${ids.length} tool(s) contributed by \`${owner}\` have no registered ` +
        `permission: ${ids.join(', ')}. That plugin should register them in its own bootstrap ` +
        `so it also works without ai-chat installed. Until it does, those tools cannot be ` +
        `granted in Settings > Roles, and any existing grants are pruned at boot.`,
    );
  }
}

/**
 * Warn when nothing grants any of our tool actions.
 *
 * Registering actions and granting them are different things: Strapi filters
 * `tools/list` per caller, so a token holding none of these actions gets a
 * successful but *empty* tool list — no error, and the registration logs above
 * still read as success. That is exactly the state an upgrade lands in, since
 * Strapi prunes permission rows whose action id no longer exists (the pre-1.2.0
 * `plugin::ai-chat.mcp.*` tiers). Without this warning the only symptom is a
 * client that mysteriously sees no tools.
 *
 * Advisory only — never throws, never blocks boot.
 */
async function warnIfNothingGranted(strapi: Core.Strapi, actionIds: string[]): Promise<void> {
  if (actionIds.length === 0) return;

  try {
    // `admin::permission` holds BOTH kinds of grant: rows linked to a role
    // (admin users, i.e. in-Strapi chat) and rows linked to an admin API
    // token (external MCP clients). One count covers both.
    //
    // Do NOT also check `admin::api-token-permission` — that table belongs to
    // *content-API* tokens serving /api/*, which never hold `.tool.` actions.
    // Querying it always returns 0 and cannot affect the result.
    const grants = await strapi.db
      .query('admin::permission')
      .count({ where: { action: { $in: actionIds } } });

    if (grants === 0) {
      strapi.log.warn(
        `[ai-chat:mcp] ${actionIds.length} tool permission(s) registered, but no role or API ` +
          `token grants any of them. MCP clients will authenticate successfully and receive an ` +
          `EMPTY tools/list, and in-Strapi chat will have no tools. Grant them under each ` +
          `plugin's section in Settings > Roles (for chat) or Settings > Admin Tokens ` +
          `(for MCP). ` +
          `If you upgraded from a version using plugin::ai-chat.mcp.read/.write/.destructive/` +
          `.maintenance, those actions no longer exist and their grants were pruned — the tools ` +
          `must be re-granted individually.`,
      );
    }
  } catch (error) {
    // A failed advisory check must never affect boot.
    strapi.log.debug(
      `[ai-chat:mcp] Could not check whether tool permissions are granted: ${
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
  strapi.log.info(`[ai-chat:mcp] Registered ${defs.length} custom admin permission(s).`);

  // Contributed tools are registered by the plugins that own them; flag any
  // that nobody registered rather than letting their grants disappear quietly.
  warnAboutUnownedTools(strapi, registry);

  await warnIfNothingGranted(
    strapi,
    defs.map((d) => `plugin::${d.pluginName}.${d.uid}`),
  );
}
