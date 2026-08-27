import type { Core } from '@strapi/strapi';
import type { PluginInstance } from './lib/types';

const PLUGIN_ID = 'ai-chat';

const destroy = async ({ strapi }: { strapi: Core.Strapi }) => {
  try {
    const plugin = strapi.plugin(PLUGIN_ID) as unknown as PluginInstance;

    if (plugin.aiProvider) {
      plugin.aiProvider.destroy();
      plugin.aiProvider = undefined;
    }
  } catch (error) {
    strapi.log.error(`[${PLUGIN_ID}] Error during cleanup`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export default destroy;
