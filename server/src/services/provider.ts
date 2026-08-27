import { AIProvider } from '../lib/ai-provider';

/**
 * Strapi service exposing AIProvider.registerProvider() so a host app can
 * bring its own model without forking the plugin or reaching past the
 * package's public exports map:
 *
 *   // src/index.ts
 *   export default {
 *     register({ strapi }) {
 *       strapi.plugin('ai-chat').service('provider').register(
 *         'my-model',
 *         ({ apiKey, baseURL }) => {
 *           const client = createMyClient({ apiKey, baseURL });
 *           return (modelId: string) => client.languageModel(modelId);
 *         }
 *       );
 *     },
 *   };
 *
 * Registration is safe to call from either the host app's register() or
 * bootstrap() — the plugin resolves the provider creator lazily on first
 * model use, not during its own bootstrap, so ordering relative to the
 * plugin's lifecycle hooks does not matter. See lib/ai-provider.ts for
 * details.
 */
const providerService = () => {
  return {
    /**
     * Register a named provider creator. `name` is the value to set in
     * `config.provider` (e.g. `{ provider: 'my-model' }`).
     */
    register: AIProvider.registerProvider,
  };
};

export default providerService;
