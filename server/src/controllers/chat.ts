import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { Readable } from 'node:stream';
import { getService, validateChatBody } from '../lib/utils';

/**
 * The streaming chat endpoint.
 *
 * Deliberately still holds its plumbing: abort wiring, SSE headers and the
 * Web-to-Node stream conversion are HTTP concerns, and moving them to a service
 * would only hand the service a `ctx` to work around.
 */
const chatController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async chat(ctx: Context) {
    const body = validateChatBody(ctx);
    if (!body) return;

    const service = getService(strapi, ctx);
    if (!service) return;

    const adminUserId = ctx.state?.user?.id;

    // Stop generating when the client hangs up.
    //
    // Without this, pressing Stop in the panel only aborts the browser's fetch.
    // The server keeps streaming into a socket nobody is reading, the model
    // keeps generating, and the remaining tool calls still run — so a stopped
    // turn goes on costing tokens and still writes whatever it was about to
    // write. The signal reaches streamText, which cancels the run, and each
    // tool's execute, which can cancel its own work.
    // Listen on the RESPONSE, not the request. `req`'s 'close' also fires on a
    // normally completed request in current Node, which would abort every
    // healthy stream. `res` 'close' plus a `writableFinished` check
    // distinguishes "client went away" from "we finished sending".
    const abort = new AbortController();
    ctx.res.once('close', () => {
      if (!ctx.res.writableFinished) abort.abort();
    });

    const result = await service.chat(body.messages, {
      system: body.system,
      adminUserId,
      enabledToolSources: body.enabledToolSources,
      // RBAC: the model only sees tools this admin's role grants.
      ability: ctx.state?.userAbility,
      abortSignal: abort.signal,
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
});

export default chatController;
