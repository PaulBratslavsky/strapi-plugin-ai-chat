import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginConfig, PluginInstance } from '../lib/types';
import { DEFAULT_MODEL } from '../lib/types';
import { getService, validateBody, validateChatBody, createSSEStream, writeSSE } from '../lib/utils';
import { actionForTool } from '../lib/tool-permissions';

const PLUGIN_ID = 'ai-sdk';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Chat endpoint using AI SDK UI message stream protocol
   * Compatible with useChat hook from @ai-sdk/react
   */
  async chat(ctx: Context) {
    const body = validateChatBody(ctx);
    if (!body) return;

    const service = getService(strapi, ctx);
    if (!service) return;

    const adminUserId = ctx.state?.user?.id;
    const result = await service.chat(body.messages, {
      system: body.system,
      adminUserId,
      enabledToolSources: body.enabledToolSources,
      // RBAC: the model only sees tools this admin's role grants.
      ability: ctx.state?.userAbility,
    });

    // Get the response using toUIMessageStreamResponse
    const response = result.toUIMessageStreamResponse();

    // Set headers for streaming
    ctx.status = 200;
    ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
    ctx.set('Cache-Control', 'no-cache, no-transform');
    ctx.set('Connection', 'keep-alive');
    ctx.set('X-Accel-Buffering', 'no');
    ctx.set('x-vercel-ai-ui-message-stream', 'v1');

    // Convert Web ReadableStream to Node.js Readable stream for Koa
    ctx.body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  },

  /**
   * Report which model is serving chat and whether inference is local.
   *
   * "Local" is inferred from the baseURL host rather than the provider name,
   * because `openai-compatible` covers both self-hosted runtimes (Ollama, vLLM,
   * LM Studio) and hosted OpenAI-compatible APIs. Only a loopback/private host
   * means the data genuinely is not leaving the machine — which is the whole
   * point of the claim, so it should not be guessed from the provider label.
   */
  async getModelInfo(ctx: Context) {
    const config = strapi.config.get<PluginConfig>('plugin::ai-sdk');
    const provider = config?.provider ?? 'anthropic';
    const model = config?.chatModel ?? DEFAULT_MODEL;
    const baseURL = config?.baseURL;

    let isLocal = false;
    if (baseURL) {
      try {
        const host = new URL(baseURL).hostname;
        isLocal =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '::1' ||
          host === 'host.docker.internal' ||
          host.endsWith('.local') ||
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
      } catch {
        isLocal = false;
      }
    }

    ctx.body = { data: { provider, model, baseURL: baseURL ?? null, isLocal } };
  },

  async getToolSources(ctx: Context) {
    const plugin = strapi.plugin('ai-sdk') as unknown as PluginInstance;
    const registry = plugin.toolRegistry;

    if (!registry) {
      ctx.badRequest('Tool registry not initialized');
      return;
    }

    // Hide sources the caller cannot actually use. Without this the chat UI
    // offers toggles for tools that createTools() will withhold, so turning
    // one on appears to do nothing.
    const ability = ctx.state?.userAbility;
    const sources = registry.getToolSources().filter((source) => {
      if (!ability) return true;
      return source.tools.some((name) => ability.can(actionForTool(name)));
    });

    ctx.body = { data: sources };
  },

});

export default controller;
