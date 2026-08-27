import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import type { UIMessage } from 'ai';

/**
 * Get the AI SDK service with initialization check
 */
export function getService(strapi: Core.Strapi, ctx: Context) {
  const service = strapi.plugin('ai-chat').service('chat');

  if (!service.isInitialized()) {
    ctx.badRequest('AI SDK not initialized. Check plugin configuration.');
    return null;
  }

  return service;
}

/**
 * Validate request body for message-based chat requests
 */
export function validateChatBody(ctx: Context): { messages: UIMessage[]; system?: string; enabledToolSources?: string[] } | null {
  const { messages, system, enabledToolSources } = ctx.request.body as {
    messages?: UIMessage[];
    system?: string;
    enabledToolSources?: string[];
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    ctx.badRequest('messages is required and must be a non-empty array');
    return null;
  }

  if (system !== undefined && typeof system !== 'string') {
    ctx.badRequest('system must be a string if provided');
    return null;
  }

  if (enabledToolSources !== undefined && (!Array.isArray(enabledToolSources) || !enabledToolSources.every((s) => typeof s === 'string'))) {
    ctx.badRequest('enabledToolSources must be an array of strings if provided');
    return null;
  }

  return { messages, system, enabledToolSources };
}
