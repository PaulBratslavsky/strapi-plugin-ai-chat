import type { Core } from '@strapi/strapi';

export interface Captured {
  tools: any[];
  resources: any[];
  actions: any[];
  logs: { level: string; message: string }[];
}

export interface FakeStrapiOptions {
  /** When false, strapi.ai.mcp.isEnabled() returns false. Default true. */
  mcpEnabled?: boolean;
  /** When false, strapi.ai is undefined (simulates Strapi < 5.47). Default true. */
  hasAiNamespace?: boolean;
}

/**
 * Minimal stand-in for Core.Strapi covering only what the MCP bridge touches:
 * the logger, the admin permission service, and the strapi.ai.mcp namespace.
 * Everything registered is recorded in `captured` for assertions.
 */
export function createFakeStrapi(options: FakeStrapiOptions = {}): {
  strapi: Core.Strapi;
  captured: Captured;
} {
  const { mcpEnabled = true, hasAiNamespace = true } = options;

  const captured: Captured = { tools: [], resources: [], actions: [], logs: [] };

  const log = (level: string) => (message: string) => {
    captured.logs.push({ level, message });
  };

  const ai = hasAiNamespace
    ? {
        mcp: {
          isEnabled: () => mcpEnabled,
          isRunning: () => false,
          registerTool: (tool: any) => captured.tools.push(tool),
          registerResource: (resource: any) => captured.resources.push(resource),
          registerPrompt: () => undefined,
          start: async () => undefined,
          stop: async () => undefined,
        },
      }
    : undefined;

  const strapi = {
    log: {
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
      debug: log('debug'),
    },
    service: (uid: string) => {
      if (uid === 'admin::permission') {
        return {
          actionProvider: {
            registerMany: async (defs: any[]) => {
              captured.actions.push(...defs);
            },
          },
        };
      }
      return undefined;
    },
    ai,
  } as unknown as Core.Strapi;

  return { strapi, captured };
}
