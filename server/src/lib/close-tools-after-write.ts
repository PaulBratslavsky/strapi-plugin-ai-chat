import type { ToolSet } from 'ai';
import type { ToolRegistry } from './tool-registry';
import { tierFor } from '../mcp/access';

/**
 * Withdraw a mutating tool once it has succeeded.
 *
 * Models re-plan from scratch on every step. After `createContent` returns,
 * nothing in the conversation says the work is finished and the tool is still
 * on the table, so calling it again is a plausible next move. Observed against
 * qwen3.6-35b: three or four `createContent` calls for one article, then a
 * summary. When the step limit interrupts that loop the turn ends with
 * `finishReason: 'tool-calls'` and no text at all, which renders as an empty
 * message.
 *
 * Removing the tool from the offered set makes the repeat impossible rather
 * than merely unlikely, and leaves writing the summary as the only move left.
 *
 * Only mutating tools are withdrawn. Read tools stay available, because a
 * model legitimately re-reads: searching again with different filters, or
 * fetching the document it just created to confirm the result.
 *
 * This is not model-specific. Any model can loop on a write; smaller and
 * reasoning models simply do it more often.
 */

/** Tools that change something. Derived from the same metadata as permissions. */
function mutatingToolNames(registry: ToolRegistry): Set<string> {
  const names = new Set<string>();
  for (const [name, def] of registry.getAll()) {
    if (tierFor(def) !== 'read') {
      names.add(name);
    }
  }
  return names;
}

interface StepInfo {
  toolCalls?: Array<{ toolName?: string }>;
  toolResults?: Array<{ toolName?: string }>;
}

/**
 * Build a `prepareStep` handler for the AI SDK.
 *
 * Returns undefined when the registry exposes no mutating tools, so the SDK is
 * handed nothing to call in that case.
 */
export function closeToolsAfterWrite(registry: ToolRegistry, tools: ToolSet) {
  const mutating = mutatingToolNames(registry);
  if (mutating.size === 0) return undefined;

  const allNames = Object.keys(tools);

  return ({ steps }: { steps: StepInfo[] }) => {
    const used = new Set<string>();

    for (const step of steps ?? []) {
      // A result, not merely a call: a tool that threw should stay available
      // so the model can correct its arguments and retry.
      for (const result of step.toolResults ?? []) {
        if (result.toolName && mutating.has(result.toolName)) {
          used.add(result.toolName);
        }
      }
    }

    if (used.size === 0) return {};

    // `activeTools`, not `tools`. PrepareStepResult has no `tools` field, so
    // returning one is silently ignored and the model keeps every tool.
    return { activeTools: allNames.filter((name) => !used.has(name)) };
  };
}
