// The permission action a tool is gated behind.
//
// Deliberately NOT in `mcp/`: these actions gate three different callers, and
// only one of them is MCP.
//
//   mcp/register-tools.ts  -> external MCP clients (admin tokens)
//   tools/index.ts         -> in-Strapi chat (admin roles)
//   controllers/controller -> /tool-sources, so the chat UI only offers
//                             sources the caller can actually use
//
// Living under mcp/ implied MCP-only ownership and made the chat call sites
// read like they were reaching into the wrong subsystem.
import { toActionSlug, getToolSource } from '../mcp/naming';

export const AI_SDK_PLUGIN_NAME = 'ai-chat';

/**
 * The plugin that OWNS a tool's permission. Built-ins belong to ai-sdk; a tool
 * contributed by another plugin belongs to that plugin, so its permission
 * appears in that plugin's own section of the admin grid.
 */
export function pluginNameForTool(name: string): string {
  const source = getToolSource(name);
  return source === 'built-in' ? AI_SDK_PLUGIN_NAME : source;
}

/** The action id a given registry tool name is gated behind. */
export function actionForTool(name: string): string {
  return `plugin::${pluginNameForTool(name)}.tool.${toActionSlug(name)}`;
}
