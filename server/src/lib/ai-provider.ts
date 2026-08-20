import { generateText, streamText, type LanguageModel } from 'ai';

/**
 * Minimal interface for the streamText result with methods we need.
 * We define this to avoid TypeScript declaration issues with AI SDK's internal types.
 */
export interface StreamTextRawResult {
  readonly textStream: AsyncIterable<string>;
  toUIMessageStreamResponse(options?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    getErrorMessage?: (error: unknown) => string;
    sendUsage?: boolean;
  }): Response;
}

import {
  DEFAULT_MODEL,
  isPromptInput,
  type PluginConfig,
  type GenerateInput,
  type GenerateTextResult,
  type StreamTextResult,
} from './types';

type ProviderCreator = (config: { apiKey: string; baseURL?: string }) => (modelId: string) => LanguageModel;

/**
 * Blank is not a base URL.
 *
 * `env('AI_BASE_URL')` returns "" when the variable exists but is empty, and an
 * empty string still counts as "set" by the time it reaches a provider. The
 * Anthropic SDK joins it with the request path and calls `/messages`, which
 * fails as `Invalid URL` rather than as the configuration mistake it is.
 * Normalising here makes an emptied variable behave like an absent one.
 */
function normalizeBaseURL(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Resolves the API key from config, preferring the provider-neutral `apiKey`
 * field and falling back to the legacy `anthropicApiKey` field for backward
 * compatibility with existing installs. Logs a one-time deprecation warning
 * when only the legacy field is set.
 */
let deprecationWarned = false;
function resolveApiKey(cfg: Partial<PluginConfig> | undefined, log?: { warn: (msg: string) => void }): string | undefined {
  if (cfg?.apiKey) {
    return cfg.apiKey;
  }
  if (cfg?.anthropicApiKey) {
    if (!deprecationWarned) {
      deprecationWarned = true;
      log?.warn(
        '[ai-sdk] Config field "anthropicApiKey" is deprecated, use "apiKey" instead. ' +
        '"anthropicApiKey" will continue to work as a fallback.'
      );
    }
    return cfg.anthropicApiKey;
  }
  return undefined;
}

export class AIProvider {
  private static readonly providerRegistry = new Map<string, ProviderCreator>();

  private modelFactory: ((modelId: string) => LanguageModel) | null = null;
  private model: string = DEFAULT_MODEL;
  private providerName: string = 'anthropic';
  private apiKey: string | undefined;
  private baseURL: string | undefined;
  private configured = false;

  /**
   * Register a named provider creator. Safe to call at any point — plugin
   * bootstrap, a host app's register()/bootstrap(), or later — because
   * provider *resolution* is deferred until the first model call (see
   * ensureModelFactory below). This makes registration timing relative to
   * the plugin's own bootstrap irrelevant.
   */
  static registerProvider(name: string, creator: ProviderCreator): void {
    AIProvider.providerRegistry.set(name, creator);
  }

  /**
   * Initialize the provider with plugin configuration.
   * This only captures config (apiKey/provider/baseURL/model) — it does NOT
   * resolve the provider creator from the registry. Resolution is deferred
   * to first use (see ensureModelFactory) so that a provider registered
   * after bootstrap (e.g. by a host app) still works.
   * Returns false if config is missing required fields.
   */
  initialize(config: unknown, log?: { warn: (msg: string) => void }): boolean {
    const cfg = config as Partial<PluginConfig> | undefined;

    const apiKey = resolveApiKey(cfg, log);
    const providerName = cfg?.provider ?? 'anthropic';

    // Self-hosted runtimes have no auth to speak of. Ollama, vLLM and LM Studio
    // accept any bearer token or none at all, so demanding a key here forced a
    // dummy value into config for the one setup this plugin most wants to make
    // easy. What actually matters for those is baseURL — without it there is no
    // endpoint to call, and the failure would otherwise surface as a confusing
    // request to the wrong host.
    const baseURL = normalizeBaseURL(cfg?.baseURL);

    if (providerName === 'openai-compatible') {
      if (!baseURL) {
        log?.warn(
          '[ai-sdk] provider "openai-compatible" needs a baseURL, e.g. ' +
            '"http://localhost:11434/v1" for Ollama. AI features are disabled.',
        );
        return false;
      }
    } else if (!apiKey) {
      return false;
    }

    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.providerName = providerName;

    if (cfg?.chatModel) {
      this.model = cfg.chatModel;
    }

    this.configured = true;
    return true;
  }

  /**
   * Lazily resolves the model factory from the provider registry. Deferred
   * to first use rather than initialize()/bootstrap() time so that provider
   * registration order relative to the plugin's own bootstrap never matters.
   */
  private ensureModelFactory(): (modelId: string) => LanguageModel {
    if (this.modelFactory) {
      return this.modelFactory;
    }

    if (!this.configured) {
      throw new Error('AIProvider not initialized');
    }

    const creator = AIProvider.providerRegistry.get(this.providerName);
    if (!creator) {
      throw new Error(
        `AI provider "${this.providerName}" not registered. ` +
        `Registered: ${[...AIProvider.providerRegistry.keys()].join(', ') || 'none'}. ` +
        `Register it via strapi.plugin('ai-sdk').service('provider').register('${this.providerName}', creator) ` +
        `in your app's src/index.ts register() (or bootstrap()), or use a built-in provider name ` +
        `('anthropic' or 'openai-compatible').`
      );
    }

    if (this.providerName === 'openai-compatible' && !this.baseURL) {
      throw new Error(
        `AI provider "openai-compatible" requires a "baseURL" (e.g. http://localhost:11434/v1 for Ollama). ` +
        `Set plugin::ai-sdk config { provider: 'openai-compatible', baseURL: '...' }.`
      );
    }

    this.modelFactory = creator({ apiKey: this.apiKey ?? '', baseURL: this.baseURL });
    return this.modelFactory;
  }

  private getLanguageModel(modelId?: string): LanguageModel {
    const factory = this.ensureModelFactory();
    return factory(modelId ?? this.model);
  }

  private buildParams(input: GenerateInput) {
    // `temperature` is only sent when the caller explicitly asks for it.
    // Newer Anthropic models (claude-sonnet-5 and later) reject the parameter
    // outright with "`temperature` is deprecated for this model", so sending a
    // hardcoded default broke chat on every current model. Omitting it lets each
    // model apply its own default, which is also the better behaviour.
    const base = {
      model: this.getLanguageModel(input.modelId),
      system: input.system,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      // Same reasoning as temperature: sent only when asked for. Sampling
      // parameters are model-specific — Qwen documents temperature 1 / topP
      // 0.95 / topK 20, while other models reject or ignore them — so the
      // plugin carries no defaults and lets each model apply its own.
      ...(input.topP !== undefined ? { topP: input.topP } : {}),
      ...(input.topK !== undefined ? { topK: input.topK } : {}),
      ...(input.frequencyPenalty !== undefined ? { frequencyPenalty: input.frequencyPenalty } : {}),
      ...(input.presencePenalty !== undefined ? { presencePenalty: input.presencePenalty } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      // Escape hatch for anything provider-specific the SDK exposes but this
      // config does not name, e.g. { openaiCompatible: { ... } }.
      ...(input.providerOptions !== undefined ? { providerOptions: input.providerOptions } : {}),
      maxOutputTokens: input.maxOutputTokens,
      tools: input.tools,
      stopWhen: input.stopWhen,
    };

    return isPromptInput(input)
      ? { ...base, prompt: input.prompt }
      : { ...base, messages: input.messages };
  }

  async generate(input: GenerateInput): Promise<GenerateTextResult> {
    const result = await generateText(this.buildParams(input));
    return { text: result.text };
  }

  async stream(input: GenerateInput): Promise<StreamTextResult> {
    const result = streamText(this.buildParams(input));
    return { textStream: result.textStream };
  }

  /**
   * Returns the raw streamText result for use with toUIMessageStreamResponse().
   * Compatible with AI SDK UI hooks (useChat, useCompletion).
   */
  streamRaw(input: GenerateInput): StreamTextRawResult {
    return streamText(this.buildParams(input)) as StreamTextRawResult;
  }

  // Convenience methods for simple prompt-based calls
  async generateText(prompt: string, options?: Omit<GenerateInput, 'prompt' | 'messages'>): Promise<GenerateTextResult> {
    return this.generate({ prompt, ...options });
  }

  async streamText(prompt: string, options?: Omit<GenerateInput, 'prompt' | 'messages'>): Promise<StreamTextResult> {
    return this.stream({ prompt, ...options });
  }

  getChatModel(): string {
    return this.model;
  }

  /**
   * True once config has been captured (apiKey + provider known), even
   * before the provider creator has actually been resolved from the
   * registry — resolution happens lazily on first model use.
   */
  isInitialized(): boolean {
    return this.configured;
  }

  destroy(): void {
    this.modelFactory = null;
    this.configured = false;
  }
}
