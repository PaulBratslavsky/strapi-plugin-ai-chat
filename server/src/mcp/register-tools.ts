import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolRegistry } from '../lib/tool-registry';
import { toSnakeCase, toTitle } from './naming';
import { actionForTool } from './permissions';
import { AI_SDK_PLUGIN_NAME, pluginNameForTool } from '../lib/tool-permissions';
import { guardSize } from './size-guard';

/**
 * `resolveOutputSchema` is required and must be a ZodObject, but these tools
 * return heterogeneous shapes. One permissive schema satisfies the contract
 * for all of them; tightening per tool is possible later.
 */
export const LOOSE_OUTPUT = z.object({}).catchall(z.any());

/**
 * Register this plugin's own public tools on the official Strapi MCP server.
 * Tools contributed by other plugins are skipped: their owners register them.
 *
 * Tool schemas are Zod 4 and are handed to `resolveInputSchema` untouched —
 * the MCP SDK detects Zod 4 by duck-typing and converts with its own bundled
 * zod/v4-mini. No conversion layer is needed or wanted; adding one would
 * strip `.describe()` text.
 *
 * Returns the number of tools registered.
 */
export function registerToolsOnMcp(strapi: Core.Strapi, registry: ToolRegistry): number {
  const mcp = strapi.ai!.mcp;
  let count = 0;
  const leftToOwners = new Map<string, string[]>();

  for (const [name, def] of registry.getPublic()) {
    // A tool another plugin contributed is that plugin's to put on MCP. This
    // plugin only reads it from the `ai-tools` service for the chat panel.
    // Registering it here too made the tool disappear from MCP whenever this
    // plugin was not installed, and collides by name with the owner's own
    // registration.
    const owner = pluginNameForTool(name);
    if (owner !== AI_SDK_PLUGIN_NAME) {
      leftToOwners.set(owner, [...(leftToOwners.get(owner) ?? []), name]);
      continue;
    }

    const mcpName = toSnakeCase(name);

    // The official server's capability registry throws synchronously on
    // registration conflicts (duplicate name across plugins/content-manager,
    // missing auth policies, etc). One bad tool must not take down the whole
    // MCP registration pass — or Strapi's boot — so each tool gets its own
    // try/catch and a skip-and-continue on failure.
    try {
      mcp.registerTool({
        name: mcpName,
        title: toTitle(name),
        description: def.description,
        resolveInputSchema: () => def.schema as any,
        resolveOutputSchema: () => LOOSE_OUTPUT as any,
        auth: { policies: [{ action: actionForTool(name) }] },
        createHandler: (s: Core.Strapi) => async ({ args }: { args?: unknown }) => {
          try {
            const raw = await def.execute(args ?? {}, s);
            const result = guardSize(raw, def.name);

            // structuredContent must be an object because the output schema is
            // a ZodObject. Wrap arrays and scalars so every tool complies.
            const structuredContent =
              result && typeof result === 'object' && !Array.isArray(result)
                ? (result as Record<string, unknown>)
                : { result };

            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            s.log.error(`[ai-chat:mcp] Tool ${def.name} failed: ${message}`);
            // Error is a separate branch of the union: isError present,
            // structuredContent absent. Never both.
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message }) }],
              isError: true as const,
            };
          }
        },
      } as any);
      count++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      strapi.log.warn(
        `[ai-chat:mcp] Skipped tool "${name}" (mcp name "${mcpName}") — registration failed: ${message}`,
      );
    }
  }

  // Strapi's MCP service cannot say which tools are registered, so this cannot
  // check that the owner did its part. Naming what was left is the next best
  // thing: a plugin written for ai-chat 3.4.0 or earlier does not register its
  // own tools, and this line is where that gap shows up.
  for (const [owner, names] of leftToOwners) {
    strapi.log.info(
      `[ai-chat:mcp] ${names.length} tool(s) from \`${owner}\` are in the chat but left to ` +
        `\`${owner}\` to register on MCP: ${names.map(toSnakeCase).join(', ')}`,
    );
  }

  return count;
}
