import type { Context } from 'koa';
import { RecordNotFound } from './owned-records';
import { InvalidMessages } from '../services/conversation';

/**
 * Turn a service error into the right HTTP response.
 *
 * Keeps controllers free of try/catch ladders and, more usefully, keeps the
 * mapping in one place: a record the caller does not own reports 404 rather
 * than 403 everywhere, so no route accidentally discloses that another admin's
 * record exists.
 */
export async function handle(ctx: Context, work: () => Promise<unknown>, notFound: string) {
  try {
    return { ok: true as const, value: await work() };
  } catch (error) {
    if (error instanceof RecordNotFound) {
      ctx.status = 404;
      ctx.body = { error: notFound };
      return { ok: false as const };
    }

    if (error instanceof InvalidMessages) {
      ctx.status = 400;
      ctx.body = { error: `Invalid messages payload — ${error.detail}` };
      return { ok: false as const };
    }

    throw error;
  }
}
