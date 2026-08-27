import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { readStoredMessages, toStoredMessages } from '../lib/stored-messages';

const CONTENT_TYPE = 'plugin::ai-chat.conversation' as const;

function getAdminUserId(ctx: Context): number | null {
  const id = ctx.state?.user?.id;
  return typeof id === 'number' ? id : null;
}

const conversationController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const conversations = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['title', 'createdAt', 'updatedAt'],
      sort: { updatedAt: 'desc' },
    });

    ctx.body = { data: conversations };
  },

  async findOne(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { id } = ctx.params;
    const conversation = await strapi.documents(CONTENT_TYPE).findOne({
      documentId: id,
    });

    if (!conversation || conversation.adminUserId !== adminUserId) {
      ctx.status = 404;
      ctx.body = { error: 'Conversation not found' };
      return;
    }

    // Rows written before 2.1 hold a bare legacy array. Convert on read so the
    // client only ever sees the current shape; the row itself is rewritten the
    // next time this conversation is saved.
    const { messages, migrated, error } = readStoredMessages(conversation.messages);

    if (error) {
      strapi.log.warn(
        `[ai-sdk] conversation ${id} has unreadable messages (${error}); returning it empty ` +
          'rather than failing the request. The stored value is left untouched.',
      );
    } else if (migrated) {
      strapi.log.debug(`[ai-sdk] conversation ${id} read from the legacy message format`);
    }

    ctx.body = { data: { ...conversation, messages } };
  },

  async create(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const { title, messages } = ctx.request.body as { title?: string; messages?: unknown };

    // The messages field is `"type": "json"` — Strapi validates nothing, so a
    // malformed client would otherwise write a shape nothing can read back.
    const stored = toStoredMessages(messages ?? []);
    if (!stored.ok) {
      ctx.status = 400;
      ctx.body = { error: `Invalid messages payload — ${stored.error}` };
      return;
    }

    const conversation = await strapi.documents(CONTENT_TYPE).create({
      data: {
        title: title || 'New conversation',
        messages: stored.value,
        adminUserId,
      },
    });

    ctx.status = 201;
    ctx.body = { data: conversation };
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
      ctx.body = { error: 'Conversation not found' };
      return;
    }

    const { title, messages } = ctx.request.body as { title?: string; messages?: unknown };

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;

    if (messages !== undefined) {
      const stored = toStoredMessages(messages);
      if (!stored.ok) {
        ctx.status = 400;
        ctx.body = { error: `Invalid messages payload — ${stored.error}` };
        return;
      }
      // Writing the current envelope here is what makes legacy rows heal: a
      // conversation converts permanently the first time it is saved.
      data.messages = stored.value;
    }

    const conversation = await strapi.documents(CONTENT_TYPE).update({
      documentId: id,
      data: data as any,
    });

    ctx.body = { data: conversation };
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
      ctx.body = { error: 'Conversation not found' };
      return;
    }

    await strapi.documents(CONTENT_TYPE).delete({ documentId: id });

    ctx.status = 200;
    ctx.body = { data: { documentId: id } };
  },
});

export default conversationController;
