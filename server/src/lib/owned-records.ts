import type { Core } from '@strapi/strapi';

/**
 * CRUD over records that belong to one admin.
 *
 * Notes, memories and tasks are the same shape: a collection scoped to its
 * owner, where reading someone else's row is a bug and writing one is a
 * vulnerability. That ownership check was written out per route, per
 * controller, which meant the security rule lived in five places and applied
 * only where somebody remembered it.
 *
 * Here it is enforced in one place and cannot be skipped: `update` and
 * `remove` refuse a record the caller does not own, and report it as missing
 * rather than forbidden, so the existence of another admin's row is not
 * disclosed.
 */

export interface OwnedRecordsConfig {
  uid: string;
  /** Fields returned by `list`. */
  fields: string[];
  sort?: Record<string, 'asc' | 'desc'>;
  /** Applied on create when the caller omits them. */
  defaults?: Record<string, unknown>;
  /** The only fields a caller may write. Anything else is ignored. */
  writable: string[];
}

export class RecordNotFound extends Error {
  constructor() {
    super('not found');
    this.name = 'RecordNotFound';
  }
}

/** Keep only the fields a caller is allowed to set, dropping undefined. */
function pickWritable(input: Record<string, unknown>, writable: string[]) {
  const out: Record<string, unknown> = {};
  for (const key of writable) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

export function ownedRecords(strapi: Core.Strapi, config: OwnedRecordsConfig) {
  const docs = () => strapi.documents(config.uid as any);

  /** Fetch a record only if this admin owns it. */
  async function owned(adminUserId: number, documentId: string) {
    const record = await docs().findOne({ documentId });
    if (!record || (record as any).adminUserId !== adminUserId) {
      throw new RecordNotFound();
    }
    return record;
  }

  return {
    async list(adminUserId: number) {
      return docs().findMany({
        filters: { adminUserId } as any,
        fields: config.fields as any,
        ...(config.sort ? { sort: config.sort as any } : {}),
      });
    },

    async create(adminUserId: number, input: Record<string, unknown>) {
      return docs().create({
        data: {
          ...(config.defaults ?? {}),
          ...pickWritable(input, config.writable),
          adminUserId,
        } as any,
      });
    },

    async update(adminUserId: number, documentId: string, input: Record<string, unknown>) {
      await owned(adminUserId, documentId);

      return docs().update({
        documentId,
        data: pickWritable(input, config.writable) as any,
      });
    },

    async remove(adminUserId: number, documentId: string) {
      await owned(adminUserId, documentId);
      await docs().delete({ documentId });
      return { documentId };
    },

    async clear(adminUserId: number) {
      const rows = await docs().findMany({
        filters: { adminUserId } as any,
        fields: ['documentId'] as any,
      });

      for (const row of rows) {
        await docs().delete({ documentId: (row as any).documentId });
      }

      return { deleted: rows.length };
    },
  };
}
