import type { Core } from '@strapi/strapi';
import type { ToolRegistry } from '../lib/tool-registry';
import { generateToolGuide } from './resources/tool-guide';
import { MCP_ACTIONS } from './access';

export const TOOL_GUIDE_URI = 'strapi://ai-sdk/tools/guide';

/**
 * Register static MCP resources.
 *
 * The official server does not let plugins set server-level `instructions`,
 * so the tool guide carries the usage guidance the retired server used to
 * send in its instructions string.
 */
export function registerResourcesOnMcp(strapi: Core.Strapi, registry: ToolRegistry): void {
  strapi.ai!.mcp.registerResource({
    name: 'ai-sdk-tool-guide',
    uri: TOOL_GUIDE_URI,
    metadata: {
      description:
        'Complete guide to all available Strapi AI SDK tools, with parameters and usage examples.',
      mimeType: 'text/markdown',
    },
    auth: { policies: [{ action: MCP_ACTIONS.read }] },
    createHandler: () => async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          // Generated per read so newly discovered plugin tools appear.
          text: generateToolGuide(registry),
        },
      ],
    }),
  } as any);
}
