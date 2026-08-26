import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { PassThrough } from 'node:stream';
import type { GuardrailConfig } from './types';
import { loadPatterns, extractUserInput, runGuardrails } from './index';

const DEFAULT_BLOCKED_MESSAGE =
  "I'm unable to process that request. It was flagged by content safety guardrails.";

/**
 * Send a blocked response as an SSE stream so the chat UI renders it
 * as a normal assistant message.
 */
function respondWithChatMessage(ctx: Context, message: string): void {
  ctx.status = 200;
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
  ctx.set('Cache-Control', 'no-cache, no-transform');
  ctx.set('Connection', 'keep-alive');
  ctx.set('X-Accel-Buffering', 'no');

  const stream = new PassThrough();
  ctx.body = stream;
  ctx.res.flushHeaders();

  stream.write(`data: ${JSON.stringify({ type: 'text-delta', delta: message })}\n\n`);
  stream.write('data: [DONE]\n\n');
  stream.end();
}

const guardrail = (
  _config: unknown,
  { strapi }: { strapi: Core.Strapi }
) => {
  const pluginConfig = strapi.config.get('plugin::ai-sdk') as Record<string, unknown> | undefined;
  const guardrailConfig = pluginConfig?.guardrails as GuardrailConfig | undefined;
  const patterns = loadPatterns(guardrailConfig);

  return async (ctx: Context, next: Next) => {
    if (guardrailConfig?.enabled === false) return next();

    const extracted = extractUserInput(ctx);
    if (!extracted) return next();

    const { text, route } = extracted;

    const result = await runGuardrails(text, route, ctx, guardrailConfig, patterns);
    if (!result.blocked) return next();

    const reason = result.reason ?? guardrailConfig?.blockedMessage ?? DEFAULT_BLOCKED_MESSAGE;

    // Always the chat shape, because `/chat` is the only route this middleware
    // is attached to and the only one extractUserInput recognises. A 403 would
    // surface in the panel as a failed request with no explanation, which
    // reads as a bug rather than a refusal.
    respondWithChatMessage(ctx, reason);
  };
};

export default guardrail;
