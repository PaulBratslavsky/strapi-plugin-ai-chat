import type { Core } from '@strapi/strapi';
import { ownedRecords, RecordNotFound } from '../lib/owned-records';
import { readStoredMessages, toStoredMessages } from '../lib/stored-messages';

/**
 * Chat history, owned by the admin who created it.
 *
 * Beyond ownership this carries the one rule the rest of the plugin depends on:
 * the `messages` field is `"type": "json"`, so Strapi validates nothing about
 * it. Every write goes through `toStoredMessages` and every read through
 * `readStoredMessages`, which is what keeps a malformed client from writing a
 * shape nothing can read back.
 *
 * That conversion sat in the controller, which put a storage-format invariant
 * behind an HTTP route. Anything else reaching this content type bypassed it.
 */

export class InvalidMessages extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = 'InvalidMessages';
  }
}

const conversation = ({ strapi }: { strapi: Core.Strapi }) => {
  const UID = 'plugin::ai-chat.conversation';
  const docs = () => strapi.documents(UID as any);

  const records = ownedRecords(strapi, {
    uid: UID,
    fields: ['title', 'createdAt', 'updatedAt'],
    sort: { updatedAt: 'desc' },
    writable: ['title'],
  });

  /** Validate a caller's messages, or refuse the write. */
  function validate(messages: unknown) {
    const stored = toStoredMessages(messages ?? []);
    if (!stored.ok) throw new InvalidMessages(stored.error ?? 'invalid messages payload');
    return stored.value;
  }

  return {
    list: records.list,
    remove: records.remove,

    /**
     * One conversation, with its messages in the current shape.
     *
     * Rows written before 2.1 hold a bare legacy array; they are converted on
     * read and rewritten the next time the conversation is saved. An unreadable
     * row returns empty rather than failing, so a corrupt row costs that
     * conversation's history and not the ability to open the page.
     */
    async get(adminUserId: number, documentId: string) {
      const row = await docs().findOne({ documentId });
      if (!row || (row as any).adminUserId !== adminUserId) throw new RecordNotFound();

      const { messages, migrated, error } = readStoredMessages((row as any).messages);

      if (error) {
        strapi.log.warn(
          `[ai-chat] conversation ${documentId} has unreadable messages (${error}); returning it ` +
            'empty rather than failing the request. The stored value is left untouched.',
        );
      } else if (migrated) {
        strapi.log.debug(`[ai-chat] conversation ${documentId} read from the legacy message format`);
      }

      return { ...(row as any), messages };
    },

    async create(adminUserId: number, input: { title?: string; messages?: unknown }) {
      return docs().create({
        data: {
          title: input.title || 'New conversation',
          messages: validate(input.messages),
          adminUserId,
        } as any,
      });
    },

    async update(
      adminUserId: number,
      documentId: string,
      input: { title?: string; messages?: unknown },
    ) {
      const row = await docs().findOne({ documentId });
      if (!row || (row as any).adminUserId !== adminUserId) throw new RecordNotFound();

      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.messages !== undefined) data.messages = validate(input.messages);

      return docs().update({ documentId, data: data as any });
    },
  };
};

export default conversation;
