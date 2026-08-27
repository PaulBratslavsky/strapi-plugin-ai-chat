import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { requireAdminUserId } from '../lib/require-admin-user';
import { handle } from '../lib/respond';

const NOT_FOUND = 'Memory not found';

const memoryController = ({ strapi }: { strapi: Core.Strapi }) => {
  const memories = () => strapi.plugin('ai-chat').service('memory');

  return {
    async find(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      ctx.body = { data: await memories().list(adminUserId) };
    },

    async create(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const body = ctx.request.body as { content?: string };
      if (!body?.content || typeof body.content !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'content is required' };
        return;
      }

      ctx.status = 201;
      ctx.body = { data: await memories().create(adminUserId, body) };
    },

    async update(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(
        ctx,
        () => memories().update(adminUserId, ctx.params.id, ctx.request.body as any),
        NOT_FOUND,
      );
      if (result.ok) ctx.body = { data: result.value };
    },

    async delete(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(
        ctx,
        () => memories().remove(adminUserId, ctx.params.id),
        NOT_FOUND,
      );
      if (result.ok) ctx.body = { data: result.value };
    },
  };
};

export default memoryController;
