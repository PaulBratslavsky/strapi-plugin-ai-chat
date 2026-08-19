import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

const CONTENT_TYPE = 'plugin::ai-sdk.task' as const;

function getAdminUserId(ctx: Context): number | null {
  const id = ctx.state?.user?.id;
  return typeof id === 'number' ? id : null;
}

/**
 * Derive priority from the consequence x impact score (1-25).
 *
 * The task UI and the manageTask tool both present consequence x impact as the
 * ranking mechanism, but priority was previously whatever the caller sent (or
 * 'medium'), so a 5x5 task could sit at 'medium' forever and the score was
 * purely decorative. Deriving it server-side keeps every client consistent.
 */
function derivePriority(consequence: number, impact: number): 'low' | 'medium' | 'high' | 'urgent' {
  const score = consequence * impact;
  if (score >= 20) return 'urgent';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

const taskController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const tasks = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      sort: { createdAt: 'desc' },
    });

    ctx.body = { data: tasks };
  },

  async create(ctx: Context) {
    const adminUserId = getAdminUserId(ctx);
    if (!adminUserId) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }

    const body = ctx.request.body as Record<string, unknown>;

    const task = await strapi.documents(CONTENT_TYPE).create({
      data: {
        title: body.title,
        description: body.description,
        content: body.content,
        done: body.done ?? false,
        priority: derivePriority(
          (body.consequence as number) ?? 3,
          (body.impact as number) ?? 3,
        ),
        consequence: body.consequence ?? 3,
        impact: body.impact ?? 3,
        dueDate: body.dueDate,
        adminUserId,
      },
    });

    ctx.status = 201;
    ctx.body = { data: task };
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
      ctx.body = { error: 'Task not found' };
      return;
    }

    const body = ctx.request.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'content', 'done', 'priority', 'consequence', 'impact', 'dueDate']) {
      if (body[key] !== undefined) data[key] = body[key];
    }

    const task = await strapi.documents(CONTENT_TYPE).update({
      documentId: id,
      data: data as any,
    });

    ctx.body = { data: task };
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
      ctx.body = { error: 'Task not found' };
      return;
    }

    await strapi.documents(CONTENT_TYPE).delete({ documentId: id });

    ctx.status = 200;
    ctx.body = { data: { documentId: id } };
  },
});

export default taskController;
