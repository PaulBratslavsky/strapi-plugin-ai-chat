import type { ModelMessage, ToolSet, StopCondition } from 'ai';
import type { AIProvider } from './ai-provider';
import type { ToolRegistry } from './tool-registry';
import type { GuardrailConfig } from '../guardrails/types';

// StopCondition uses a generic that varies by tool implementation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStopCondition = StopCondition<any>;

/**
 * Known-good Anthropic model ids, verified against the API on 2026-08-18.
 *
 * This is a reference list, NOT an allowlist — `chatModel` is typed `string`,
 * so any model id works, including local ones like `gemma4:26b` when using the
 * `openai-compatible` provider.
 *
 * Undated aliases are preferred over dated snapshots: every dated snapshot
 * previously listed here had been retired by Anthropic, which silently broke
 * the plugin's default. Aliases track the current release instead.
 */
export const CHAT_MODELS = [
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-fable-5',
  'claude-haiku-4-5-20251001',
] as const;

export type ChatModelName = (typeof CHAT_MODELS)[number];

export const DEFAULT_MODEL: ChatModelName = 'claude-sonnet-5';
/**
 * Not applied by default. Newer Anthropic models reject `temperature`
 * ("`temperature` is deprecated for this model"), so the provider only sends it
 * when a caller sets it explicitly. Kept for callers that opt in on a model
 * known to accept it.
 */
export const DEFAULT_TEMPERATURE = 0.7;

export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_MAX_CONVERSATION_MESSAGES = 15;
export const DEFAULT_MAX_STEPS = 10;

/**
 * How long a single tool call may run before it is abandoned.
 *
 * Nothing else bounds a tool. A network call with no timeout of its own — a
 * transcript fetch against a host that is blocking you, say — hangs the whole
 * turn: the panel shows a spinner that never resolves, and no error is ever
 * produced to explain it. Sixty seconds is longer than any built-in tool needs
 * and short enough that a wedged call becomes a legible failure rather than a
 * frozen chat.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

export interface PluginConfig {
  /** Provider-neutral API key. Preferred over the deprecated anthropicApiKey. */
  apiKey?: string;
  /** @deprecated Use `apiKey` instead. Kept as a fallback for existing installs. */
  anthropicApiKey?: string;
  provider?: string;
  chatModel?: string;
  /** Sampling parameters. Omit unless your model documents them. */
  temperature?: number;
  topP?: number;
  topK?: number;
  baseURL?: string;
  systemPrompt?: string;
  maxOutputTokens?: number;
  maxConversationMessages?: number;
  /** Max tool call round-trips per response. */
  maxSteps?: number;
  /**
   * Milliseconds a single tool call may run before it is abandoned. Set to 0
   * to disable, which restores the old behaviour of waiting forever.
   */
  toolTimeoutMs?: number;
  /**
   * Tokens the model can actually read. Only needed when it cannot be
   * detected, since a served window often differs from what the weights
   * support.
   */
  contextWindow?: number;
  guardrails?: GuardrailConfig;
}

export interface GenerateOptions {
  system?: string;
  temperature?: number;
  /** Nucleus sampling. Qwen documents 0.95; omit to use the model's default. */
  topP?: number;
  /** Top-k sampling. Qwen documents 20. Not every provider supports it. */
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  /** Fixes sampling for reproducible output, where the provider supports it. */
  seed?: number;
  /**
   * Provider-specific options passed straight to the AI SDK. Values must be
   * JSON-serialisable; typed loosely because each provider defines its own.
   */
  providerOptions?: Record<string, Record<string, any>>;
  maxOutputTokens?: number;
  tools?: ToolSet;
  stopWhen?: AnyStopCondition;
  /**
   * Per-step override hook. Used to withdraw a mutating tool once it has
   * succeeded, so the model cannot call it again. See
   * lib/close-tools-after-write.ts.
   */
  prepareStep?: (options: any) => any;
  /** Max tool call round-trips before stopping */
  maxSteps?: number;
  /** Override model for this request (e.g. use Haiku for public chat) */
  modelId?: string;
  /**
   * Cancels generation, including any further steps. Wired to the HTTP request
   * in the chat controller, so a client that goes away stops costing money
   * instead of streaming into a socket nobody is reading.
   */
  abortSignal?: AbortSignal;
}

export interface PromptInput extends GenerateOptions {
  prompt: string;
}

export interface MessagesInput extends GenerateOptions {
  messages: ModelMessage[];
}

export type GenerateInput = PromptInput | MessagesInput;

export interface GenerateTextResult {
  text: string;
}

export interface StreamTextResult {
  textStream: AsyncIterable<string>;
}

// Type guard to check if input is prompt-based
export function isPromptInput(input: GenerateInput): input is PromptInput {
  return 'prompt' in input;
}

// --- Plugin instance types (shared across bootstrap, destroy, controllers) ---

export interface PluginInstance {
  aiProvider?: AIProvider;
  toolRegistry?: ToolRegistry;
}
