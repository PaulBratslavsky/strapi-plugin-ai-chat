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
    //
    // Internal tools are exempt. They never reach MCP, so buildMcpActionDefs()
    // - which walks getPublic() - never registers an action for them. Gating
    // them here would withhold them from everyone including a Super Admin,
    // because the action they would need does not exist to be granted. That
    // silently disabled saveMemory, recallMemories, saveNote, recallNotes,
    // recallPublicMemories, and manageTask on every authenticated request.
    //
    // Exempting rather than registering actions for them is deliberate: these
    // are chat-internal bookkeeping scoped to the calling admin's own data,
    // not capabilities worth scoping separately.
    if (ability && !def.internal && !ability.can(actionForTool(name))) continue;

    tools[name] = tool({
      description: def.description,
      inputSchema: zodSchema(def.schema) as any,
      execute: async (args: any) => {
        try {
          return await def.execute(args, strapi, context);
        } catch (error) {
          // Rethrown rather than returned: the SDK marks the step a tool
          // error, which is what lets the model try again on the next step.
          throw new Error(describeToolFailure(error));
        }
      },
    });
  }

  return tools;
}


/**
 * Turn a thrown error into something the model can act on.
 *
 * Strapi's ValidationError summarises to "3 errors occurred" and keeps the
 * per-field causes in `details.errors`, which the AI SDK never sees because it
 * serialises the error by its message alone. A model handed that count knows
 * only that the write failed, so its retry is another guess - and a model that
 * runs out of guesses tends to claim the save succeeded rather than admit it
 * could not do it.
 *
 * Flattening the details into the message is what makes the second attempt
 * differ from the first.
 */
export function describeToolFailure(error: unknown): string {
  const err = error as any;
  const base = err?.message ?? String(error);
  const details = err?.details?.errors ?? err?.error?.details?.errors;

  if (!Array.isArray(details) || details.length === 0) return base;

  const lines = details.map((d: any) => {
    const path = Array.isArray(d?.path) ? d.path.join('.') : d?.path;
    const message = d?.message ?? 'invalid';
    return path ? `${path}: ${message}` : message;
  });

  return `${base} - ${lines.join('; ')}`;
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
