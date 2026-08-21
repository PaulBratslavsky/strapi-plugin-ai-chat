import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginConfig, PluginInstance } from '../lib/types';
import { DEFAULT_MODEL } from '../lib/types';
import { getService, validateBody, validateChatBody, createSSEStream, writeSSE } from '../lib/utils';
import { actionForTool } from '../lib/tool-permissions';
import {
  detectContextWindow,
  measureTools,
  estimateTokens,
  warnAboutBudget,
  type ContextReport,
} from '../lib/context-budget';
import { buildPreamble } from '../services/service';

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

    // Attach token usage to the assistant message so the panel can show how
    // much of the window the conversation is using. Without this the client
    // has no idea what a turn cost, and the point at which a conversation
    // stops fitting arrives with no warning.
    const response = result.toUIMessageStreamResponse({
      messageMetadata: ({ part }: { part: any }) => {
        if (part?.type !== 'finish') return undefined;
        const usage = part.totalUsage ?? part.usage;
        if (!usage) return undefined;
        return {
          usage: {
            inputTokens: usage.inputTokens ?? null,
            outputTokens: usage.outputTokens ?? null,
            totalTokens: usage.totalTokens ?? null,
          },
        };
      },
    } as any);

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
  /**
   * What the conversation costs before it starts.
   *
   * Measured for the calling admin rather than in general, because the tool
   * set is filtered by their role: two admins on the same install can face
   * very different preambles, and the one with more tools is the one closer
   * to the edge.
   */
  async getContextInfo(ctx: Context) {
    const config = strapi.config.get<PluginConfig>('plugin::ai-sdk');

    const { system, tools } = buildPreamble(strapi, {
      adminUserId: ctx.state?.user?.id,
      ability: ctx.state?.userAbility,
    });

    const toolMeasure = measureTools(tools);
    const systemTokens = estimateTokens(system);
    const preambleTokens = systemTokens + toolMeasure.tokens;

    const detected = await detectContextWindow(config);

    const base = {
      systemTokens,
      toolTokens: toolMeasure.tokens,
      toolCount: toolMeasure.count,
      preambleTokens,
      contextWindow: detected.window,
      windowSource: detected.source,
      trainedContext: detected.trained ?? null,
      preambleShare: detected.window ? preambleTokens / detected.window : null,
    };

    const report: ContextReport = {
      ...base,
      warning: warnAboutBudget(base),
      estimated: true,
    };

    ctx.body = { data: report };
  },

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

  /**
   * Is the configured model actually reachable?
   *
   * A model that has gone away produces a stream that opens with 200 and then
   * dies, which the panel had no way to distinguish from a slow answer. The
   * header can now say so before a message is sent, rather than leaving the
   * user to guess why nothing came back.
   *
   * The check is deliberately cheap. For OpenAI-compatible endpoints that is
   * GET /models, which costs nothing and needs no tokens. Anthropic has no
   * comparable free probe, so a configured key is reported as `unknown` rather
   * than spending money to turn the badge green.
   */
  async getModelHealth(ctx: Context) {
    const config = strapi.config.get<PluginConfig>('plugin::ai-sdk');
    const provider = config?.provider ?? 'anthropic';
    const baseURL = config?.baseURL;
    const model = config?.chatModel ?? DEFAULT_MODEL;

    const respond = (status: string, detail?: string) => {
      ctx.body = { data: { status, detail: detail ?? null, provider, model, checkedAt: new Date().toISOString() } };
    };

    if (provider !== 'openai-compatible') {
      const hasKey = Boolean(config?.apiKey || config?.anthropicApiKey);
      respond(hasKey ? 'unknown' : 'unconfigured', hasKey ? 'No free probe for this provider' : 'No API key configured');
      return;
    }

    if (!baseURL) {
      respond('unconfigured', 'openai-compatible requires a baseURL');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const headers: Record<string, string> = {};
      const key = config?.apiKey;
      if (key) headers.Authorization = `Bearer ${key}`;

      const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
        headers,
        signal: controller.signal,
      });

      if (res.ok) {
        // Confirm the configured model is actually served, not just that
        // something answered. A renamed or unloaded model is the more common
        // failure once an endpoint is up.
        let served: string[] = [];
        try {
          const body = (await res.json()) as { data?: Array<{ id?: string }> };
          served = (body?.data ?? []).map((m) => m.id).filter(Boolean) as string[];
        } catch {
          // endpoint answered but not in the documented shape; treat as up
        }
        if (served.length > 0 && !served.includes(model)) {
          respond('model-missing', `Endpoint is up but does not serve "${model}". Available: ${served.slice(0, 6).join(', ')}`);
          return;
        }
        respond('ok');
        return;
      }

      respond(res.status === 401 || res.status === 403 ? 'unauthorized' : 'down', `Endpoint returned ${res.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = /abort/i.test(message);
      respond('down', isTimeout ? 'Timed out after 5s' : message.slice(0, 160));
    } finally {
      clearTimeout(timer);
    }
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
