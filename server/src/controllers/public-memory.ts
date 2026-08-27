import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

/** Shared across every admin, so there is no owner to check. */
const publicMemoryController = ({ strapi }: { strapi: Core.Strapi }) => {
  const shared = () => strapi.plugin('ai-chat').service('public-memory');

  return {
    async find(ctx: Context) {
      ctx.body = { data: await shared().list() };
    },

    async create(ctx: Context) {
      const body = ctx.request.body as { content?: string; category?: string };
      if (!body?.content || typeof body.content !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'content is required' };
        return;
      }

      ctx.status = 201;
      ctx.body = { data: await shared().create(body as { content: string; category?: string }) };
    },

    async update(ctx: Context) {
      ctx.body = { data: await shared().update(ctx.params.id, ctx.request.body as any) };
    },

    async delete(ctx: Context) {
      ctx.body = { data: await shared().remove(ctx.params.id) };
    },
  };
};

export default publicMemoryController;
