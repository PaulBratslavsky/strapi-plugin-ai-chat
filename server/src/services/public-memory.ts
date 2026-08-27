import type { Core } from '@strapi/strapi';

/**
 * Memory shared by every admin on the project.
 *
 * Deliberately not built on `ownedRecords`: these rows have no owner, so there
 * is no ownership check to enforce and no `adminUserId` to filter by. Any admin
 * can read, edit and delete any entry, which is the point of the content type.
 *
 * The name is historical. It was reachable by anonymous visitors before public
 * chat moved to its own plugin in 2.0.0; since then "public" has meant shared
 * across the team, and the admin UI says so.
 */
const publicMemory = ({ strapi }: { strapi: Core.Strapi }) => {
  const UID = 'plugin::ai-chat.public-memory';
  const docs = () => strapi.documents(UID as any);

  return {
    async list() {
      return docs().findMany({
        fields: ['content', 'category', 'createdAt'] as any,
        sort: { createdAt: 'desc' } as any,
      });
    },

    async create(input: { content: string; category?: string }) {
      return docs().create({
        data: { content: input.content, category: input.category || 'general' } as any,
      });
    },

    async update(documentId: string, input: Record<string, unknown>) {
      const data: Record<string, unknown> = {};
      if (input.content !== undefined) data.content = input.content;
      if (input.category !== undefined) data.category = input.category;

      return docs().update({ documentId, data: data as any });
    },

    async remove(documentId: string) {
      await docs().delete({ documentId });
      return { documentId };
    },
  };
};

export default publicMemory;
