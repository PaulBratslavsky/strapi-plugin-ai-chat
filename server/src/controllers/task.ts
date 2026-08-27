import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { requireAdminUserId } from '../lib/require-admin-user';
import { handle } from '../lib/respond';

const NOT_FOUND = 'Task not found';

const taskController = ({ strapi }: { strapi: Core.Strapi }) => {
  const tasks = () => strapi.plugin('ai-chat').service('task');

  return {
    async find(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      ctx.body = { data: await tasks().list(adminUserId) };
    },

    async create(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const body = ctx.request.body as { title?: string };
      if (!body?.title || typeof body.title !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'title is required' };
        return;
      }

      ctx.status = 201;
      ctx.body = { data: await tasks().create(adminUserId, body) };
    },

    async update(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(
        ctx,
        () => tasks().update(adminUserId, ctx.params.id, ctx.request.body as any),
        NOT_FOUND,
      );
      if (result.ok) ctx.body = { data: result.value };
    },

    async delete(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(ctx, () => tasks().remove(adminUserId, ctx.params.id), NOT_FOUND);
      if (result.ok) ctx.body = { data: result.value };
    },
  };
};

export default taskController;
