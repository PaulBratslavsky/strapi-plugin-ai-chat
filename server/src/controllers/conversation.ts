import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { requireAdminUserId } from '../lib/require-admin-user';
import { handle } from '../lib/respond';

const NOT_FOUND = 'Conversation not found';

const conversationController = ({ strapi }: { strapi: Core.Strapi }) => {
  const conversations = () => strapi.plugin('ai-chat').service('conversation');

  return {
    async find(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      ctx.body = { data: await conversations().list(adminUserId) };
    },

    async findOne(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(
        ctx,
        () => conversations().get(adminUserId, ctx.params.id),
        NOT_FOUND,
      );
      if (result.ok) ctx.body = { data: result.value };
    },

    async create(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(
        ctx,
        () => conversations().create(adminUserId, ctx.request.body as any),
        NOT_FOUND,
      );
      if (result.ok) {
        ctx.status = 201;
        ctx.body = { data: result.value };
      }
    },

    async update(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(
        ctx,
        () => conversations().update(adminUserId, ctx.params.id, ctx.request.body as any),
        NOT_FOUND,
      );
      if (result.ok) ctx.body = { data: result.value };
    },

    async delete(ctx: Context) {
      const adminUserId = requireAdminUserId(ctx);
      if (adminUserId === null) return;

      const result = await handle(
        ctx,
        () => conversations().remove(adminUserId, ctx.params.id),
        NOT_FOUND,
      );
      if (result.ok) ctx.body = { data: result.value };
    },
  };
};

export default conversationController;
