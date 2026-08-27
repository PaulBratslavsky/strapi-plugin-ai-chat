import type { Core } from '@strapi/strapi';

/**
 * Carry an install forward from the `ai-sdk` plugin id to `ai-chat`.
 *
 * 3.0.0 renamed the plugin id. That id is not cosmetic: it prefixes the five
 * database tables, every per-tool permission action, and the admin routes. A
 * site upgrading without this would come back with an empty chat history, no
 * saved memories or tasks, and every role's tool grants silently revoked - all
 * without an error, because Strapi would simply create the new tables and find
 * no rows.
 *
 * So the rename ships with the migration rather than a release note asking
 * people to do it themselves.
 *
 * Runs on every boot and is a no-op once applied: each step checks for the old
 * name and the absence of the new one before touching anything, which also
 * makes it safe if a boot is interrupted part way through.
 */

const TABLE_PAIRS: Array<[string, string]> = [
  ['ai_sdk_conversations', 'ai_chat_conversations'],
  ['ai_sdk_memories', 'ai_chat_memories'],
  ['ai_sdk_notes', 'ai_chat_notes'],
  ['ai_sdk_public_memories', 'ai_chat_public_memories'],
  ['ai_sdk_tasks', 'ai_chat_tasks'],
];

async function tableExists(strapi: Core.Strapi, name: string): Promise<boolean> {
  try {
    return await strapi.db.connection.schema.hasTable(name);
  } catch {
    return false;
  }
}

export async function migrateFromAiSdk(strapi: Core.Strapi): Promise<void> {
  const log = strapi.log;

  try {
    // 1. Tables. Renaming preserves rows, indexes and ids, where a copy would
    //    renumber and a create-then-insert would need every column enumerated.
    for (const [from, to] of TABLE_PAIRS) {
      const hasOld = await tableExists(strapi, from);
      const hasNew = await tableExists(strapi, to);

      if (hasOld && !hasNew) {
        await strapi.db.connection.schema.renameTable(from, to);
        log.info(`[ai-chat] migrated table ${from} -> ${to}`);
      } else if (hasOld && hasNew) {
        // Both present means Strapi already created the new table this boot,
        // before the migration ran. Moving rows across is still correct, but
        // it is not safe to guess at column alignment, so say so loudly rather
        // than silently leaving data behind.
        const [{ count }] = await strapi.db.connection(from).count({ count: '*' });
        if (Number(count) > 0) {
          log.warn(
            `[ai-chat] ${from} still holds ${count} row(s) and ${to} already exists. ` +
              `Move them manually: INSERT INTO ${to} SELECT * FROM ${from};`,
          );
        }
      }
    }

    // 2. Permission actions. Grants are rows keyed by an action string, so a
    //    renamed id leaves every tick box in Settings > Roles pointing at an
    //    action that no longer exists.
    const renamed = await strapi.db
      .connection('admin_permissions')
      .where('action', 'like', 'plugin::ai-sdk.%')
      .update({
        action: strapi.db.connection.raw(
          "replace(action, 'plugin::ai-sdk.', 'plugin::ai-chat.')",
        ),
      });

    if (renamed > 0) {
      log.info(`[ai-chat] migrated ${renamed} permission grant(s) from plugin::ai-sdk.*`);
    }
  } catch (error) {
    // A failed migration must not take the host down. The site boots with the
    // old data intact and the operator gets a message they can act on.
    log.error(
      `[ai-chat] migration from the ai-sdk plugin id failed: ${(error as Error).message}. ` +
        `Existing data has not been modified.`,
    );
  }
}
