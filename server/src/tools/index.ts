import type { Core } from '@strapi/strapi';
import type { ToolSet } from 'ai';
import { tool, zodSchema } from 'ai';
import type { PluginConfig, PluginInstance } from '../lib/types';
import { DEFAULT_TOOL_TIMEOUT_MS } from '../lib/types';
import type { ToolContext } from '../lib/tool-registry';
import { actionForTool } from '../lib/tool-permissions';
import { createCallCoalescer } from '../lib/coalesce-calls';

/**
 * Abandon a tool call that never comes back.
 *
 * A tool with no timeout of its own can hang the entire turn. The panel shows
 * a spinner on a tool that will never settle, the step never completes, and
 * nothing is ever logged — the failure produces no error to read. Observed
 * with a transcript fetch against a host that had started blocking us.
 *
 * Rejecting instead turns that into an ordinary tool error, which the model
 * can report or retry, and which says which tool stalled and for how long.
 *
 * The timer is always cleared, including on the success path, so a fast tool
 * does not leave a pending timeout holding the event loop open.
 */
async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  toolName: string,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return work(callerSignal ?? new AbortController().signal);
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();

  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          `${toolName} timed out after ${Math.round(timeoutMs / 1000)}s and was abandoned. ` +
            `The call may have been blocked or the service may be unreachable. ` +
            `Tell the user this tool did not respond rather than assuming it succeeded.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    // The tool is handed the derived signal, so one that honours it stops on
    // timeout too. One that ignores it keeps running in the background — the
    // turn is freed either way, which is the point.
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export function createTools(strapi: Core.Strapi, context?: ToolContext): ToolSet {
  const plugin = strapi.plugin('ai-chat') as unknown as PluginInstance;
  const registry = plugin.toolRegistry;

  if (!registry) {
    throw new Error('Tool registry not initialized');
  }

  const enabledSources = context?.enabledToolSources;
  const ability = context?.ability;
  const tools: ToolSet = {};

  // Optional chaining because not every caller arrives with a full Strapi:
  // tests build a minimal one, and a missing config should fall back to the
  // default rather than take the whole tool set down.
  const config = strapi.config?.get?.<PluginConfig>('plugin::ai-chat');
  const toolTimeoutMs = config?.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  // Scoped to this tool set, so it lives exactly as long as one request and
  // concurrent users never share an execution.
  const coalescer = createCallCoalescer();

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
      execute: async (args: any, options?: { abortSignal?: AbortSignal }) => {
        try {
          // The SDK's own signal is passed in, so stopping the request stops
          // a tool that is already running — not just the steps after it.
          // Join an identical call already running rather than repeating it.
          // A model can issue the same call twice in one step, and the second
          // only doubles load for a result it already has coming.
          return await coalescer.run(name, args, () =>
            withTimeout(
              (signal) => def.execute(args, strapi, { ...context, abortSignal: signal }),
              toolTimeoutMs,
              name,
              options?.abortSignal,
            ),
          );
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
