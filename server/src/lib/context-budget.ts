import type { ToolSet } from 'ai';
import type { PluginConfig } from './types';

/**
 * How much of the model's context window is already spoken for.
 *
 * This exists because the most expensive failure in this plugin is invisible.
 * A chat request carries the system prompt and every tool's JSON schema before
 * the user's question is read, which measured close to 7,000 tokens against a
 * real app. Ollama serves a 4,096 token window unless the model file sets
 * `num_ctx`, so a model advertising 262,144 tokens of context can be quietly
 * truncated to less than the preamble needs. The symptom is not an error. The
 * model hangs, or answers while ignoring its tools, and the natural conclusion
 * is that tool calling is broken.
 *
 * Reporting the numbers turns that into something a person can see before they
 * spend an afternoon on it.
 */

/**
 * Tokens per character, averaged.
 *
 * Deliberately a heuristic rather than a real tokenizer. Loading one per
 * provider would add a dependency and a startup cost to a number whose only
 * job is to say "you are near the edge" or "you are nowhere near it". Callers
 * are told it is an estimate.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The serialised size of the tool schemas as the provider will send them. */
export function measureTools(tools: ToolSet): { count: number; tokens: number } {
  const names = Object.keys(tools);
  let chars = 0;

  for (const name of names) {
    const def = (tools as Record<string, any>)[name];
    chars += name.length;
    chars += String(def?.description ?? '').length;
    try {
      // The schema travels as JSON, so its serialised form is what costs
      // tokens, not the object graph.
      chars += JSON.stringify(def?.inputSchema?.jsonSchema ?? def?.inputSchema ?? {}).length;
    } catch {
      // A schema that will not serialise is not measurable; skip rather than
      // fail the whole report.
    }
  }

  return { count: names.length, tokens: estimateTokens('x'.repeat(chars)) };
}

export type WindowSource =
  | 'config'
  | 'ollama-running'
  | 'ollama-modelfile'
  | 'ollama-default'
  | 'unknown';

export interface ContextWindow {
  window: number | null;
  source: WindowSource;
  /** What the weights support, when that differs from what is being served. */
  trained?: number | null;
}

/** Ollama's documented default when a model file does not set `num_ctx`. */
export const OLLAMA_DEFAULT_NUM_CTX = 4096;

/**
 * Work out the window actually in force, which is not the same as the window
 * the model was trained for.
 *
 * Order matters. A running instance is authoritative, because that is the
 * value serving requests right now. The model file comes next, then Ollama's
 * default, which is the case worth catching.
 */
export async function detectContextWindow(
  config: PluginConfig | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ContextWindow> {
  if (config?.contextWindow) {
    return { window: config.contextWindow, source: 'config' };
  }

  const baseURL = config?.baseURL;
  const model = config?.chatModel;
  if (!baseURL || !model) return { window: null, source: 'unknown' };

  // Ollama's OpenAI-compatible endpoint lives under /v1, while the native API
  // that reports context sits at the origin.
  let origin: string;
  try {
    origin = new URL(baseURL).origin;
  } catch {
    return { window: null, source: 'unknown' };
  }

  const ask = async (path: string, body: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return res.ok ? ((await res.json()) as Record<string, any>) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const show = await ask('/api/show', { model });
  if (!show) return { window: null, source: 'unknown' };

  const info = (show.model_info ?? {}) as Record<string, unknown>;
  const trainedEntry = Object.entries(info).find(([k]) => k.endsWith('context_length'));
  const trained = typeof trainedEntry?.[1] === 'number' ? (trainedEntry[1] as number) : null;

  // A loaded instance reports the window it is actually serving.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetchImpl(`${origin}/api/ps`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const ps = (await res.json()) as Record<string, any>;
      const running = (ps.models ?? []).find(
        (m: any) => m.name === model || m.name === `${model}:latest`,
      );
      if (running?.context_length) {
        return { window: running.context_length, source: 'ollama-running', trained };
      }
    }
  } catch {
    // Not fatal: fall through to the model file.
  }

  const numCtx = String(show.parameters ?? '')
    .split('\n')
    .map((line: string) => line.trim().match(/^num_ctx\s+(\d+)$/))
    .find(Boolean);

  if (numCtx) {
    return { window: Number(numCtx[1]), source: 'ollama-modelfile', trained };
  }

  return { window: OLLAMA_DEFAULT_NUM_CTX, source: 'ollama-default', trained };
}

export interface ContextReport {
  systemTokens: number;
  toolTokens: number;
  toolCount: number;
  preambleTokens: number;
  contextWindow: number | null;
  windowSource: WindowSource;
  trainedContext?: number | null;
  /** Fraction of the window consumed before the conversation starts. */
  preambleShare: number | null;
  warning: string | null;
  estimated: true;
}

/**
 * Flag the arrangement that looks like a broken plugin.
 *
 * A preamble that does not fit leaves nothing for the question. A preamble
 * over half the window leaves too little for a transcript and a reply, which
 * is where multi step tool work quietly stops working.
 */
export function warnAboutBudget(report: Omit<ContextReport, 'warning' | 'estimated'>): string | null {
  const { contextWindow, preambleTokens, windowSource, trainedContext } = report;
  if (!contextWindow) return null;

  const truncatedByDefault =
    windowSource === 'ollama-default' && trainedContext && trainedContext > contextWindow;

  if (preambleTokens >= contextWindow) {
    return (
      `Instructions and tool definitions alone need about ${preambleTokens} tokens, ` +
      `but the model is serving a ${contextWindow} token window. Requests cannot fit` +
      (truncatedByDefault
        ? `, even though this model supports ${trainedContext}. Set num_ctx on the model.`
        : '. Raise the context window or reduce the number of enabled tools.')
    );
  }

  if (preambleTokens > contextWindow / 2) {
    return (
      `Instructions and tool definitions use about ${preambleTokens} of ${contextWindow} tokens ` +
      `before the conversation starts, which leaves little room for tool results` +
      (truncatedByDefault ? `. This model supports ${trainedContext}; set num_ctx to use it.` : '.')
    );
  }

  if (truncatedByDefault) {
    return (
      `This model supports ${trainedContext} tokens but is serving ${contextWindow}, ` +
      `which is Ollama's default. Set num_ctx on the model to use its full context.`
    );
  }

  return null;
}
