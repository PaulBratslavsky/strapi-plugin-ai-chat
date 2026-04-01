import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { MCPSession, PluginConfig, PluginInstance } from '../lib/types';

const PLUGIN_ID = 'ai-sdk';

// Default values (also set in config/index.ts, but kept here as fallbacks)
const DEFAULT_SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_CLEANUP_INTERVAL = 100;

function isSessionExpired(session: { createdAt: number }, timeoutMs: number): boolean {
  return Date.now() - session.createdAt > timeoutMs;
}

async function cleanupExpiredSessions(
  plugin: PluginInstance,
  strapi: Core.Strapi,
  timeoutMs: number
): Promise<void> {
  let cleaned = 0;
  for (const [sessionId, session] of plugin.mcpSessions!.entries()) {
    if (isSessionExpired(session, timeoutMs)) {
      try {
        await session.server.close();
      } catch {
        // Ignore close errors
      }
      plugin.mcpSessions!.delete(sessionId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    strapi.log.debug(`[${PLUGIN_ID}:mcp] Cleaned up ${cleaned} expired sessions`);
  }
}

async function closeSessionQuietly(server: Server): Promise<void> {
  try {
    await server.close();
  } catch {
    // Ignore close errors during cleanup
  }
}

function jsonRpcError(ctx: Context, status: number, code: number, message: string) {
  ctx.status = status;
  ctx.body = { jsonrpc: '2.0', error: { code, message }, id: null };
}

function getSessionId(ctx: Context): string | undefined {
  const raw = ctx.request.headers['mcp-session-id'];
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveSession(
  plugin: PluginInstance,
  strapi: Core.Strapi,
  requestedSessionId: string | undefined,
  timeoutMs: number
): Promise<{ session: MCPSession | null; expired: boolean }> {
  if (!requestedSessionId) return { session: null, expired: false };

  const session = plugin.mcpSessions!.get(requestedSessionId) ?? null;
  if (!session) return { session: null, expired: false };

  if (isSessionExpired(session, timeoutMs)) {
    strapi.log.debug(`[${PLUGIN_ID}:mcp] Session expired, removing: ${requestedSessionId}`);
    await closeSessionQuietly(session.server);
    plugin.mcpSessions!.delete(requestedSessionId);
    return { session: null, expired: true };
  }

  return { session, expired: false };
}

async function createSession(
  plugin: PluginInstance,
  strapi: Core.Strapi,
  maxSessions: number,
  timeoutMs: number
): Promise<{ session: MCPSession; sessionId: string } | null> {
  if (plugin.mcpSessions!.size >= maxSessions) {
    await cleanupExpiredSessions(plugin, strapi, timeoutMs);
    if (plugin.mcpSessions!.size >= maxSessions) return null;
  }

  const sessionId = randomUUID();
  if (!plugin.createMcpServer) return null;
  const server = plugin.createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });

  await server.connect(transport);

  const session: MCPSession = { server, transport, createdAt: Date.now() };
  plugin.mcpSessions!.set(sessionId, session);
  strapi.log.debug(`[${PLUGIN_ID}:mcp] New session created: ${sessionId}`);

  return { session, sessionId };
}

async function handleTransport(
  ctx: Context,
  session: MCPSession,
  currentSessionId: string | undefined,
  plugin: PluginInstance,
  strapi: Core.Strapi
): Promise<void> {
  try {
    await session.transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
    ctx.respond = false;
  } catch (transportError) {
    strapi.log.warn(`[${PLUGIN_ID}:mcp] Transport error, cleaning up session: ${currentSessionId}`, {
      error: transportError instanceof Error ? transportError.message : String(transportError),
    });

    await closeSessionQuietly(session.server);
    if (currentSessionId) {
      plugin.mcpSessions!.delete(currentSessionId);
    }

    if (!ctx.res.headersSent) {
      jsonRpcError(ctx, 400, -32000, 'Session transport error. Please reinitialize the connection.');
    }
  }
}

type SessionResult =
  | { ok: true; session: MCPSession; sessionId: string | undefined }
  | { ok: false; status: number; code: number; message: string };

async function getOrCreateSession(
  plugin: PluginInstance,
  strapi: Core.Strapi,
  requestedSessionId: string | undefined,
  maxSessions: number,
  timeoutMs: number
): Promise<SessionResult> {
  const { session: existing, expired } = await resolveSession(plugin, strapi, requestedSessionId, timeoutMs);

  if (requestedSessionId && !existing) {
    return {
      ok: false,
      status: 400,
      code: -32000,
      message: expired
        ? 'Session expired. Please reinitialize the connection.'
        : 'Session not found. Please reinitialize the connection.',
    };
  }

  if (existing) {
    return { ok: true, session: existing, sessionId: requestedSessionId };
  }

  const created = await createSession(plugin, strapi, maxSessions, timeoutMs);
  if (!created) {
    return { ok: false, status: 429, code: -32000, message: 'Too many active sessions. Please try again later.' };
  }

  return { ok: true, session: created.session, sessionId: created.sessionId };
}

function isInvalidPostBody(ctx: Context): boolean {
  return ctx.method === 'POST' && (typeof ctx.request.body !== 'object' || ctx.request.body === null);
}

const mcpController = ({ strapi }: { strapi: Core.Strapi }) => {
  // Read MCP limits from config at controller creation time
  const config = strapi.config.get<PluginConfig>('plugin::ai-sdk');
  const timeoutMs = config?.mcp?.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const maxSessions = config?.mcp?.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const cleanupInterval = config?.mcp?.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
  let requestCount = 0;

  return {
    async handle(ctx: Context) {
      const plugin = strapi.plugin(PLUGIN_ID) as unknown as PluginInstance;

      if (!plugin.createMcpServer) {
        ctx.status = 503;
        ctx.body = { error: 'MCP not initialized', message: 'The MCP server is not available. Check plugin configuration.' };
        return;
      }

      if (++requestCount % cleanupInterval === 0) {
        await cleanupExpiredSessions(plugin, strapi, timeoutMs);
      }

      try {
        const result = await getOrCreateSession(plugin, strapi, getSessionId(ctx), maxSessions, timeoutMs);

        if (result.ok === false) {
          jsonRpcError(ctx, result.status, result.code, result.message);
          return;
        }

        if (isInvalidPostBody(ctx)) {
          jsonRpcError(ctx, 400, -32700, 'Invalid JSON-RPC request');
          return;
        }

        await handleTransport(ctx, result.session, result.sessionId, plugin, strapi);
      } catch (error) {
        strapi.log.error(`[${PLUGIN_ID}:mcp] Error handling MCP request`, {
          error: error instanceof Error ? error.message : String(error),
          method: ctx.method,
          path: ctx.path,
        });

        if (!ctx.res.headersSent) {
          ctx.status = 500;
          ctx.body = { error: 'MCP request failed', message: error instanceof Error ? error.message : 'Unknown error' };
        }
      }
    },
  };
};

export default mcpController;
