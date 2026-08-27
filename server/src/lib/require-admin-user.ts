import type { Context } from 'koa';

/**
 * The calling admin's id, or a 401 written to the response.
 *
 * Every personal-data route needs this and each one had its own copy: four
 * identical `getAdminUserId` functions and eighteen repetitions of the same
 * four-line guard. Duplication that dull is where a route eventually gets
 * added without the check.
 *
 * Returns `null` after writing the response, so a caller reads:
 *
 *     const adminUserId = requireAdminUserId(ctx);
 *     if (adminUserId === null) return;
 */
export function requireAdminUserId(ctx: Context): number | null {
  const id = ctx.state?.user?.id;

  if (typeof id !== 'number') {
    ctx.status = 401;
    ctx.body = { error: 'Unauthorized' };
    return null;
  }

  return id;
}
