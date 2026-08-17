// Entry point for registering this plugin's tools on the OFFICIAL Strapi MCP
// server. Called from bootstrap() after plugin tool discovery, so contributed
// tools are already in the registry. Registration must happen before the MCP
// server starts — it locks its capability set at start.
import type { Core } from '@strapi/strapi';
import type { ToolRegistry } from '../lib/tool-registry';
import { registerMcpAdminPermissions } from './permissions';
import { registerToolsOnMcp } from './register-tools';
import { registerResourcesOnMcp } from './register-resources';

export async function registerAiSdkMcpTools(
  strapi: Core.Strapi,
  registry: ToolRegistry,
): Promise<void> {
  const mcp = strapi.ai?.mcp;

  // strapi.ai is absent below 5.47; isEnabled() is false when the host has
  // not set `mcp: { enabled: true }` in config/server.ts.
  if (!mcp?.isEnabled()) {
    strapi.log.info(
      '[ai-sdk:mcp] Official MCP server not enabled — skipping tool registration. ' +
        'Requires Strapi >= 5.47 and `mcp: { enabled: true }` in config/server.ts.',
    );
    return;
  }

  // A failure anywhere in here (permission registration, an unexpected throw
  // during tool/resource registration) must degrade to "MCP tools
  // unavailable" — never "Strapi is down". registerToolsOnMcp already
  // isolates per-tool failures; this is the outer backstop for everything
  // else in the registration pass.
  try {
    await registerMcpAdminPermissions(strapi);
    const count = registerToolsOnMcp(strapi, registry);
    registerResourcesOnMcp(strapi, registry);

    strapi.log.info(`[ai-sdk:mcp] Registered ${count} tool(s) on the official MCP server.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    strapi.log.error(`[ai-sdk:mcp] Failed to register MCP capabilities: ${message}`);
  }
}
