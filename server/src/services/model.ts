import type { Core } from '@strapi/strapi';
import type { PluginConfig, PluginInstance } from '../lib/types';
import { DEFAULT_MODEL } from '../lib/types';
import { isServed } from '../lib/model-tag';
import { detectContextWindow, measureTools, estimateTokens, warnAboutBudget } from '../lib/context-budget';
import { buildPreamble } from './chat';
import type { CallerAbility } from '../lib/tool-registry';
import { actionForTool } from '../lib/tool-permissions';

/**
 * What the panel needs to know about the configured model: which one it is,
 * whether it can be reached, and how much of its context is already spoken for.
 *
 * These were three controller methods, which put a network probe, a timeout and
 * a status taxonomy behind an HTTP route where nothing else could reach them.
 */

export type ModelHealthStatus =
  | 'ok' | 'down' | 'unauthorized' | 'model-missing' | 'unconfigured' | 'unknown';

const PROBE_TIMEOUT_MS = 5000;

const model = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = () => strapi.config.get<PluginConfig>('plugin::ai-chat');

  return {
    /** Provider, model, and whether inference stays on your own network. */
    info() {
      const cfg = config();
      const baseURL = cfg?.baseURL;

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

      return {
        provider: cfg?.provider ?? 'anthropic',
        model: cfg?.chatModel ?? DEFAULT_MODEL,
        baseURL: baseURL ?? null,
        isLocal,
      };
    },

    /**
     * Can the model actually be reached?
     *
     * An unreachable model fails invisibly: the chat request opens with a 200
     * and the stream then dies, leaving no reply and no explanation. The check
     * is deliberately cheap - GET /models for OpenAI-compatible endpoints,
     * which costs nothing. Anthropic has no comparable free probe, so a
     * configured key reports `unknown` rather than spending money to turn a
     * badge green.
     */
    async health(): Promise<{ status: ModelHealthStatus; detail: string | null; provider: string; model: string; checkedAt: string }> {
      const cfg = config();
      const provider = cfg?.provider ?? 'anthropic';
      const chatModel = cfg?.chatModel ?? DEFAULT_MODEL;
      const baseURL = cfg?.baseURL;

      const result = (status: ModelHealthStatus, detail?: string) => ({
        status,
        detail: detail ?? null,
        provider,
        model: chatModel,
        checkedAt: new Date().toISOString(),
      });

      if (provider !== 'openai-compatible') {
        const hasKey = Boolean(cfg?.apiKey || cfg?.anthropicApiKey);
        return result(
          hasKey ? 'unknown' : 'unconfigured',
          hasKey ? 'No free probe for this provider' : 'No API key configured',
        );
      }

      if (!baseURL) return result('unconfigured', 'openai-compatible requires a baseURL');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const headers: Record<string, string> = {};
        if (cfg?.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

        const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          return result(
            res.status === 401 || res.status === 403 ? 'unauthorized' : 'down',
            `Endpoint returned ${res.status}`,
          );
        }

        // Confirm the configured model is actually served, not just that
        // something answered. A renamed or unloaded model is the more common
        // failure once an endpoint is up.
        let served: string[] = [];
        try {
          const body = (await res.json()) as { data?: Array<{ id?: string }> };
          served = (body?.data ?? []).map((m) => m.id).filter(Boolean) as string[];
        } catch {
          // Answered, but not in the documented shape. Treat as up.
        }

        if (served.length > 0 && !isServed(chatModel, served)) {
          return result(
            'model-missing',
            `Endpoint is up but does not serve "${chatModel}". Available: ${served.slice(0, 6).join(', ')}`,
          );
        }

        return result('ok');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result('down', /abort/i.test(message) ? `Timed out after ${PROBE_TIMEOUT_MS / 1000}s` : message.slice(0, 160));
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * What the conversation costs before it starts.
     *
     * Measured for the calling admin rather than in general, because the tool
     * set is filtered by their role: two admins on one install can face very
     * different preambles, and the one with more tools sits closer to the edge.
     */
    async context(caller: { adminUserId?: number; ability?: CallerAbility }) {
      const { system, tools } = buildPreamble(strapi, caller);

      const toolMeasure = measureTools(tools);
      const systemTokens = estimateTokens(system);
      const preambleTokens = systemTokens + toolMeasure.tokens;
      const detected = await detectContextWindow(config());

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

      return { ...base, warning: warnAboutBudget(base), estimated: true as const };
    },

    /**
     * Tool sources this caller can actually use.
     *
     * Without the filter the chat UI offers toggles for tools that
     * `createTools()` will withhold, so turning one on appears to do nothing.
     */
    toolSources(ability?: CallerAbility) {
      const plugin = strapi.plugin('ai-chat') as unknown as PluginInstance;
      const registry = plugin.toolRegistry;
      if (!registry) return null;

      return registry.getToolSources().filter((source: { tools: string[] }) => {
        if (!ability) return true;
        return source.tools.some((name) => ability.can(actionForTool(name)));
      });
    },
  };
};

export default model;
