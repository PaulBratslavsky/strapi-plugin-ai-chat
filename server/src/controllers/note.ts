import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

const CONTENT_TYPE = 'plugin::ai-chat.note' as const;

function getAdminUserId(ctx: Context): number | null {
  const id = ctx.state?.user?.id;
  return typeof id === 'number' ? id : null;
}

const noteController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const notes = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['title', 'content', 'category', 'tags', 'source', 'createdAt'],
      sort: { createdAt: 'desc' },
    });

    ctx.body = { data: notes };
  },

  async create(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { title, content, category, tags, source } = ctx.request.body as {
      title?: string;
      content?: string;
      category?: string;
      tags?: string;
      source?: string;
    };

    if (!content || typeof content !== 'string') {
      ctx.status = 400;
      ctx.body = { error: 'content is required' };
      return;
    }

    const note = await strapi.documents(CONTENT_TYPE).create({
      data: {
        title: title || '',
        content,
        category: category || 'research',
        tags: tags || '',
        source: source || '',
        adminUserId,
      },
    });

    ctx.status = 201;
    ctx.body = { data: note };
  },

  async update(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { id } = ctx.params;
    const existing = await strapi.documents(CONTENT_TYPE).findOne({
      documentId: id,
    });

    if (!existing || existing.adminUserId !== adminUserId) {
      ctx.status = 404;
      ctx.body = { error: 'Note not found' };
      return;
    }

    const { title, content, category, tags, source } = ctx.request.body as {
      title?: string;
      content?: string;
      category?: string;
      tags?: string;
      source?: string;
    };

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (category !== undefined) data.category = category;
    if (tags !== undefined) data.tags = tags;
    if (source !== undefined) data.source = source;

    const note = await strapi.documents(CONTENT_TYPE).update({
      documentId: id,
      data: data as any,
    });

    ctx.body = { data: note };
  },

  async delete(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { id } = ctx.params;
    const existing = await strapi.documents(CONTENT_TYPE).findOne({
      documentId: id,
    });

    if (!existing || existing.adminUserId !== adminUserId) {
      ctx.status = 404;
      ctx.body = { error: 'Note not found' };
      return;
    }

    await strapi.documents(CONTENT_TYPE).delete({ documentId: id });

    ctx.status = 200;
    ctx.body = { data: { documentId: id } };
  },

  async clearAll(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const notes = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['documentId'],
    });

    for (const note of notes) {
      await strapi.documents(CONTENT_TYPE).delete({ documentId: (note as any).documentId });
    }

    ctx.status = 200;
    ctx.body = { data: { deleted: notes.length } };
  },
});

export default noteController;
