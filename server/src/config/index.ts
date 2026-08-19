export default {
  default: {
    apiKey: '',
    // Deprecated — kept as a fallback so existing installs keep working.
    // Prefer `apiKey`, which is provider-neutral.
    anthropicApiKey: '',
    provider: 'anthropic',
    chatModel: 'claude-sonnet-4-20250514',
    baseURL: undefined,
    systemPrompt: '',
    maxOutputTokens: 8192,
    maxConversationMessages: 15,
    maxSteps: 10,
    guardrails: {
      enabled: true,
      maxInputLength: 10000,
    },
    publicChat: {
      /** Content type UIDs the public chat is allowed to query (e.g. ['api::article.article']) */
      allowedContentTypes: [] as string[],
      /** Model for public chat — defaults to Haiku for lower cost & higher rate limits */
      chatModel: 'claude-haiku-4-5-20251001',
      /** Max conversation messages for public chat */
      maxConversationMessages: 10,
      /** Max tool call steps for public chat */
      maxSteps: 5,
    },
  },
  validator(config: unknown) {
    if (typeof config !== 'object' || config === null) {
      throw new Error('Config must be an object');
    }
    const c = config as Record<string, unknown>;
    if (c.apiKey && typeof c.apiKey !== 'string') {
      throw new Error('apiKey must be a string');
    }
    if (c.anthropicApiKey && typeof c.anthropicApiKey !== 'string') {
      throw new Error('anthropicApiKey must be a string');
    }
    if (c.chatModel && typeof c.chatModel !== 'string') {
      throw new Error('chatModel must be a string');
    }
    if (c.provider && typeof c.provider !== 'string') {
      throw new Error('provider must be a string');
    }
    if (c.baseURL && typeof c.baseURL !== 'string') {
      throw new Error('baseURL must be a string');
    }
    if (c.provider === 'openai-compatible' && !c.baseURL) {
      throw new Error(
        'baseURL is required when provider is "openai-compatible" (e.g. http://localhost:11434/v1 for Ollama)'
      );
    }
  },
};
