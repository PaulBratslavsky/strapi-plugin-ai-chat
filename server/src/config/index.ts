export default {
  default: {
    apiKey: '',
    // Deprecated — kept as a fallback so existing installs keep working.
    // Prefer `apiKey`, which is provider-neutral.
    anthropicApiKey: '',
    provider: 'anthropic',
    chatModel: 'claude-sonnet-5',
    baseURL: undefined,
    systemPrompt: '',
    maxOutputTokens: 8192,
    maxConversationMessages: 15,
    maxSteps: 10,
    // Abandon a single tool call after this long. 0 disables the timeout.
    toolTimeoutMs: 60_000,
    guardrails: {
      enabled: true,
      maxInputLength: 10000,
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
    if (
      c.toolTimeoutMs !== undefined &&
      (typeof c.toolTimeoutMs !== 'number' || c.toolTimeoutMs < 0)
    ) {
      throw new Error('toolTimeoutMs must be a non-negative number (0 disables the timeout)');
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
