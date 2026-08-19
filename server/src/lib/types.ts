import type { ModelMessage, ToolSet, StopCondition } from 'ai';
import type { AIProvider } from './ai-provider';
import type { ToolRegistry } from './tool-registry';
import type { GuardrailConfig } from '../guardrails/types';

// StopCondition uses a generic that varies by tool implementation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStopCondition = StopCondition<any>;

export const CHAT_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
] as const;

export type ChatModelName = (typeof CHAT_MODELS)[number];

export const DEFAULT_MODEL: ChatModelName = 'claude-sonnet-4-20250514';
export const DEFAULT_TEMPERATURE = 0.7;

export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_MAX_CONVERSATION_MESSAGES = 15;
export const DEFAULT_PUBLIC_MAX_CONVERSATION_MESSAGES = 10;
export const DEFAULT_MAX_STEPS = 10;
export const DEFAULT_PUBLIC_MAX_STEPS = 5;
export const DEFAULT_PUBLIC_CHAT_MODEL = 'claude-haiku-4-5-20251001';

export interface PublicChatConfig {
  /** Content type UIDs the public chat is allowed to query (e.g. ['api::article.article']) */
  allowedContentTypes?: string[];
  /** Plugin tool source IDs allowed in public chat (e.g. ['yt-embeddings-strapi-plugin']). If omitted, no plugin tools are exposed. */
  publicToolSources?: string[];
  /** Model to use for public chat (defaults to Haiku for lower cost & higher rate limits) */
  chatModel?: string;
  /** Max conversation messages for public chat (defaults to 10) */
  maxConversationMessages?: number;
  /** Max tool call steps for public chat (defaults to 2) */
  maxSteps?: number;
}

export interface PluginConfig {
  /** Provider-neutral API key. Preferred over the deprecated anthropicApiKey. */
  apiKey?: string;
  /** @deprecated Use `apiKey` instead. Kept as a fallback for existing installs. */
  anthropicApiKey?: string;
  provider?: string;
  chatModel?: string;
  baseURL?: string;
  systemPrompt?: string;
  maxOutputTokens?: number;
  maxConversationMessages?: number;
  /** Max tool call steps for admin chat (defaults to 3) */
  maxSteps?: number;
  guardrails?: GuardrailConfig;
  publicChat?: PublicChatConfig;
}

export interface GenerateOptions {
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: ToolSet;
  stopWhen?: AnyStopCondition;
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
