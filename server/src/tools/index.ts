import type { Core } from '@strapi/strapi';
import type { ToolSet } from 'ai';
import { tool, zodSchema } from 'ai';
import type { PluginInstance } from '../lib/types';
import type { ToolContext } from '../lib/tool-registry';
import { actionForTool } from '../lib/tool-permissions';

export function createTools(strapi: Core.Strapi, context?: ToolContext): ToolSet {
  const plugin = strapi.plugin('ai-sdk') as unknown as PluginInstance;
  const registry = plugin.toolRegistry;

  if (!registry) {
    throw new Error('Tool registry not initialized');
  }

  const enabledSources = context?.enabledToolSources;
  const ability = context?.ability;
  const tools: ToolSet = {};

  for (const [name, def] of registry.getAll()) {
    // If enabledToolSources is provided, filter plugin tools by prefix
    if (enabledSources) {
      const sepIndex = name.indexOf('__');
      if (sepIndex !== -1) {
        const prefix = name.substring(0, sepIndex);
        if (!enabledSources.includes(prefix)) continue;
      }
      // Built-in tools (no __) are always included
    }

    // Withhold tools the caller has no permission for. Same per-tool actions
    // that gate /mcp, evaluated against whoever is calling: an admin user's
    // role grants for chat, an admin token's grants for MCP.
    if (ability && !ability.can(actionForTool(name))) continue;

    tools[name] = tool({
      description: def.description,
      inputSchema: zodSchema(def.schema) as any,
      execute: async (args: any) => def.execute(args, strapi, context),
    });
  }

  return tools;
}


/**
 * Build a system prompt section describing all available tools.
 * Reads the `description` from each tool definition so it stays in sync automatically.
 */
export function describeTools(tools: Record<string, { description?: string }>) {
  const lines = Object.entries(tools).map(
    ([name, t]) => `- ${name}: ${t.description ?? 'No description'}`
  );
  return `Available tools:\n${lines.join('\n')}`;
}
