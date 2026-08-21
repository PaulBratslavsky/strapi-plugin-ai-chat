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
export const DEFAULT_PUBLIC_MAX_CONVERSATION_MESSAGES = 10;
export const DEFAULT_MAX_STEPS = 10;
export const DEFAULT_PUBLIC_MAX_STEPS = 5;
export const DEFAULT_PUBLIC_CHAT_MODEL = 'claude-haiku-4-5-20251001';

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
  /** Max tool call steps for admin chat (defaults to 3) */
  maxSteps?: number;
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
