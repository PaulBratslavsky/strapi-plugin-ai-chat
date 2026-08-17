export default {
  default: {
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
    if (c.anthropicApiKey && typeof c.anthropicApiKey !== 'string') {
      throw new Error('anthropicApiKey must be a string');
    }
    if (c.chatModel && typeof c.chatModel !== 'string') {
      throw new Error('chatModel must be a string');
    }
  },
};
