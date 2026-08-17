import type { Core } from '@strapi/strapi';
import { createAnthropic } from '@ai-sdk/anthropic';
import { registerAiSdkMcpTools } from './mcp';
import { AIProvider } from './lib/ai-provider';
import { ToolRegistry } from './lib/tool-registry';
import { builtInTools } from './tools/definitions';
import type { PluginConfig, PluginInstance } from './lib/types';

const PLUGIN_ID = 'ai-sdk';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = strapi.plugin(PLUGIN_ID) as unknown as PluginInstance;
  const config = strapi.config.get<PluginConfig>(`plugin::${PLUGIN_ID}`);

  initializeProvider(strapi, plugin, config);
  const registry = initializeToolRegistry(plugin);
  discoverPluginTools(strapi, registry);

  await registerAiSdkMcpTools(strapi, registry);
};

export default bootstrap;

function initializeProvider(strapi: Core.Strapi, plugin: PluginInstance, config: PluginConfig) {
  AIProvider.registerProvider('anthropic', ({ apiKey, baseURL }) => {
    const provider = createAnthropic({ apiKey, baseURL });
    return (modelId: string) => provider(modelId);
  });

  const aiProvider = new AIProvider();
  const initialized = aiProvider.initialize(config);

  if (initialized) {
    plugin.aiProvider = aiProvider;
    strapi.log.info(`[${PLUGIN_ID}] AI provider initialized with model: ${aiProvider.getChatModel()}`);
  } else {
    strapi.log.warn(`[${PLUGIN_ID}] anthropicApiKey not configured, AI provider will not be available`);
  }
}

function initializeToolRegistry(plugin: PluginInstance): ToolRegistry {
  const toolRegistry = new ToolRegistry();
  for (const tool of builtInTools) {
    toolRegistry.register(tool);
  }
  plugin.toolRegistry = toolRegistry;
  return toolRegistry;
}

function discoverPluginTools(strapi: Core.Strapi, registry: ToolRegistry) {
  const pluginNames = Object.keys(strapi.plugins).filter((n) => n !== PLUGIN_ID);
  strapi.log.info(`[${PLUGIN_ID}] Scanning ${pluginNames.length} plugins for ai-tools: [${pluginNames.join(', ')}]`);

  for (const [pluginName, pluginInstance] of Object.entries(strapi.plugins)) {
    if (pluginName === PLUGIN_ID) continue;

    try {
      const aiToolsService = resolveAiToolsService(strapi, pluginName, pluginInstance);

      if (!aiToolsService?.getTools) {
        strapi.log.debug(`[${PLUGIN_ID}] No ai-tools service on plugin: ${pluginName}`);
        continue;
      }

      strapi.log.info(`[${PLUGIN_ID}] Found ai-tools service on plugin: ${pluginName}`);

      const contributed = aiToolsService.getTools();
      if (!Array.isArray(contributed)) continue;

      const count = registerContributedTools(strapi, registry, pluginName, contributed);
      if (count > 0) {
        strapi.log.info(`[${PLUGIN_ID}] Registered ${count} tools from plugin: ${pluginName}`);

        // Collect optional source metadata; it feeds the tool-guide MCP
        // resource (see mcp/resources/tool-guide.ts), not server instructions.
        const safeName = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (typeof aiToolsService.getMeta === 'function') {
          const meta = aiToolsService.getMeta();
          if (meta?.label && meta?.description) {
            registry.setSourceMeta(safeName, meta);
          }
        }
      }
    } catch (err) {
      strapi.log.warn(`[${PLUGIN_ID}] Tool discovery failed for ${pluginName}: ${err}`);
    }
  }
}

function registerContributedTools(strapi: Core.Strapi, registry: ToolRegistry, pluginName: string, tools: any[]): number {
  const safeName = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
  let count = 0;

  for (const tool of tools) {
    if (!tool.name || !tool.execute || !tool.schema) {
      strapi.log.warn(`[${PLUGIN_ID}] Invalid tool from ${pluginName}: ${tool.name || 'unnamed'}`);
      continue;
    }

    // API tool names only allow [a-zA-Z0-9_-], so use double-underscore as namespace separator
    const namespacedName = `${safeName}__${tool.name}`;
    if (registry.has(namespacedName)) {
      strapi.log.warn(`[${PLUGIN_ID}] Duplicate tool: ${namespacedName}`);
      continue;
    }

    registry.register({ ...tool, name: namespacedName });
    count++;
  }

  return count;
}

function resolveAiToolsService(strapi: Core.Strapi, pluginName: string, pluginInstance: unknown): any {
  try {
    const svc = strapi.plugin(pluginName)?.service?.('ai-tools');
    if (svc) return svc;
  } catch { /* ignore */ }
  try {
    const svc = (pluginInstance as any).service?.('ai-tools');
    if (svc) return svc;
  } catch { /* ignore */ }
  return null;
}
