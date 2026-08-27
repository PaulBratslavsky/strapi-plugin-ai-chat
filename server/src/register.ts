import type { Core } from '@strapi/strapi';
import { migrateFromAiSdk } from './lib/migrate-from-ai-sdk';

/**
 * Runs before Strapi syncs the schema, which is the only window where the
 * rename from the `ai-sdk` plugin id can move data cleanly: once the sync has
 * created the new empty tables, the old ones are orphaned beside them rather
 * than renamed into place.
 */
const register = async ({ strapi }: { strapi: Core.Strapi }) => {
  await migrateFromAiSdk(strapi);
};

export default register;
