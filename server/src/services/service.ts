import type { Core } from '@strapi/strapi';
import type { UIMessage } from 'ai';
import { convertToModelMessages, stepCountIs } from 'ai';
import type { StreamTextRawResult } from '../lib/ai-provider';
import type { PluginConfig, PluginInstance } from '../lib/types';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_CONVERSATION_MESSAGES,
  DEFAULT_PUBLIC_MAX_CONVERSATION_MESSAGES,
  DEFAULT_MAX_STEPS,
  DEFAULT_PUBLIC_MAX_STEPS,
  DEFAULT_PUBLIC_CHAT_MODEL,
  DEFAULT_MODEL,
} from '../lib/types';
import { createTools, describeTools } from '../tools';
import type { CallerAbility } from '../lib/tool-registry';
import { trimMessages } from '../lib/trim-messages';

const DEFAULT_PREAMBLE =
  `You are a Strapi CMS assistant. Use your tools to fulfill user requests. When asked to create or update content, use the appropriate tool — do not tell the user you cannot. When performing bulk operations (e.g. publish multiple items), call multiple tools in parallel in a single step rather than one at a time.

For analytics and counting questions (e.g. "how many", "count", "distribution", "trends", "breakdown"), use the aggregateContent tool instead of searchContent — it is faster and purpose-built for these queries. Present analytics results as markdown tables. After showing analytics results, suggest 2-3 follow-up questions the user might find useful under a "**You might also want to know:**" heading.

Plugin tools: When specialized tools from plugins are available (listed below), ALWAYS prefer them over the generic searchContent tool. For example, use searchMentions for social mentions (it has BM25 relevance scoring), semanticSearch for vector similarity search across embeddings, and ragQuery for question-answering grounded in embedded content. Only fall back to searchContent when no specialized tool covers the query.

Strapi filter syntax for searchContent and aggregateContent:
- Scalar fields: { title: { $containsi: "hello" } }
- Relation (manyToOne): { author: { name: { $eq: "John" } } }
- Relation (manyToMany): { contentTags: { title: { $eq: "tutorial" } } }
- Always nest relation filters as: { relationField: { fieldOnRelatedType: { $operator: value } } }
- Never use flat dot-path syntax like "contentTags.title" in filters — always use nested objects.

Task management: You have a manageTask tool for tracking the user's tasks. At the START of every conversation, proactively use manageTask with action "summary" to check for open tasks, then greet the user with a brief status and suggest what to tackle next based on consequence × impact score. When the user mentions action items, commitments, or things they need to do during conversation, proactively create tasks by calling manageTask with action "create" — do NOT include consequence or impact scores, just omit them. A UI form will appear in the chat for the user to set scores and confirm. Never ask for scores in text. When presenting task lists, use markdown tables.`;

const DEFAULT_PUBLIC_PREAMBLE =
  `You are a helpful public assistant for this website. Use your tools to answer questions about the site content. You cannot modify any content or perform administrative actions.

For analytics and counting questions (e.g. "how many", "count", "distribution", "trends", "breakdown"), use the aggregateContent tool instead of searchContent — it is faster and purpose-built for these queries. Present analytics results as markdown tables. After showing analytics results, suggest 2-3 follow-up questions the user might find useful under a "**You might also want to know:**" heading.

Strapi filter syntax for searchContent and aggregateContent:
- Scalar fields: { title: { $containsi: "hello" } }
- Relation (manyToOne): { author: { name: { $eq: "John" } } }
- Relation (manyToMany): { contentTags: { title: { $eq: "tutorial" } } }
- Always nest relation filters as: { relationField: { fieldOnRelatedType: { $operator: value } } }
- Never use flat dot-path syntax like "contentTags.title" in filters — always use nested objects.`;

function composeSystemPrompt(config: PluginConfig | undefined, toolsDescription: string, override?: string): string {
  // If the caller provided an explicit system prompt, use it as the base
  const base = override || config?.systemPrompt || DEFAULT_PREAMBLE;

  // Support {tools} placeholder in the base prompt
  if (base.includes('{tools}')) {
    return base.replace('{tools}', toolsDescription);
  }

  // Otherwise append tool descriptions
  return `${base}\n\n${toolsDescription}`;
}

const service = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = strapi.plugin('ai-sdk') as unknown as PluginInstance;

  return {


    /**
     * Chat with messages - returns raw stream for UI message stream response
     * Compatible with AI SDK UI hooks (useChat)
     */
    async chat(messages: UIMessage[], options?: { system?: string; adminUserId?: number; enabledToolSources?: string[]; ability?: CallerAbility }): Promise<StreamTextRawResult> {
      const config = strapi.config.get<PluginConfig>('plugin::ai-sdk');
      const maxMessages = config?.maxConversationMessages ?? DEFAULT_MAX_CONVERSATION_MESSAGES;
      const maxOutputTokens = config?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
      const maxSteps = config?.maxSteps ?? DEFAULT_MAX_STEPS;

      // Truncate conversation history while keeping tool call/result pairs intact
      const trimmedMessages = trimMessages(messages, maxMessages);

      const modelMessages = await convertToModelMessages(trimmedMessages);
      const tools = createTools(strapi, { adminUserId: options?.adminUserId, enabledToolSources: options?.enabledToolSources, ability: options?.ability });
      const toolsDescription = describeTools(tools);
      let system = composeSystemPrompt(config, toolsDescription, options?.system);

      // Inject user memories into system prompt
      if (options?.adminUserId) {
        try {
          const memories = await strapi.documents('plugin::ai-sdk.memory' as any).findMany({
            filters: { adminUserId: options.adminUserId },
            fields: ['content', 'category'],
          });
          if (memories.length > 0) {
            const lines = memories.map((m: any) => `- [${m.category}] ${m.content}`);
            system += `\n\nUser memories (facts you have saved about this user from previous conversations — use these to personalize your responses):\n${lines.join('\n')}`;
          }
        } catch (err) {
          strapi.log.warn('[ai-sdk] Failed to load user memories:', err);
        }
      }

      if (!plugin.aiProvider) {
        throw new Error('AI provider not initialized');
      }
      return plugin.aiProvider.streamRaw({
        messages: modelMessages,
        system,
        tools,
        maxOutputTokens,
        // Only forwarded when configured. Each is omitted entirely otherwise,
        // so models that reject a parameter never see it.
        ...(config?.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config?.topP !== undefined ? { topP: config.topP } : {}),
        ...(config?.topK !== undefined ? { topK: config.topK } : {}),
        stopWhen: stepCountIs(maxSteps),
      });
    },

    /**
     * Public chat - restricted tools, public memories, no admin auth
     */

    isInitialized() {
      return plugin.aiProvider?.isInitialized() ?? false;
    },
  };
};

export default service;
