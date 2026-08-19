import adminAPIRoutes from './admin';

/**
 * Admin routes only.
 *
 * This plugin is the chat interface inside the Strapi admin panel. It
 * deliberately exposes no content-API surface: those routes were permissioned
 * per controller method, which cannot express "this caller may search but not
 * send email", and granting `controller.chat` to the Public role handed
 * anonymous visitors the full toolset.
 *
 * The two surfaces that remain both scope per tool — admin chat via RBAC
 * role grants, and /mcp via admin token grants. Anonymous traffic is served
 * by strapi-plugin-ai-sdk-public-chat, which owns its own routes and an
 * explicit tool allow-list.
 */
const routes = {
  admin: adminAPIRoutes,
};

export default routes;
