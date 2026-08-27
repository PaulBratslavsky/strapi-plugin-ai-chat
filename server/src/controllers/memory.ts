import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

const CONTENT_TYPE = 'plugin::ai-chat.memory' as const;

function getAdminUserId(ctx: Context): number | null {
  const id = ctx.state?.user?.id;
  return typeof id === 'number' ? id : null;
}

const memoryController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const memories = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['content', 'category', 'createdAt'],
      sort: { createdAt: 'desc' },
    });

    ctx.body = { data: memories };
  },

  async create(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { content, category } = ctx.request.body as { content?: string; category?: string };

    if (!content || typeof content !== 'string') {
      ctx.status = 400;
      ctx.body = { error: 'content is required' };
      return;
    }

    const memory = await strapi.documents(CONTENT_TYPE).create({
      data: {
        content,
        category: category || 'general',
        adminUserId,
      },
    });

    ctx.status = 201;
    ctx.body = { data: memory };
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
      ctx.body = { error: 'Memory not found' };
      return;
    }

    const { content, category } = ctx.request.body as { content?: string; category?: string };

    const data: Record<string, unknown> = {};
    if (content !== undefined) data.content = content;
    if (category !== undefined) data.category = category;

    const memory = await strapi.documents(CONTENT_TYPE).update({
      documentId: id,
      data: data as any,
    });

    ctx.body = { data: memory };
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
      ctx.body = { error: 'Memory not found' };
      return;
    }

    await strapi.documents(CONTENT_TYPE).delete({ documentId: id });

    ctx.status = 200;
    ctx.body = { data: { documentId: id } };
  },
});

export default memoryController;
