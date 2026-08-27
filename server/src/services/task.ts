import type { Core } from '@strapi/strapi';
import { ownedRecords } from '../lib/owned-records';

/**
 * Derive priority from the consequence x impact score (1-25).
 *
 * Both the task UI and the manageTask tool present consequence x impact as the
 * ranking mechanism, but priority used to be whatever the caller sent, so a 5x5
 * task could sit at "medium" forever while the score said otherwise.
 *
 * This lived in the controller, which meant it applied to tasks created through
 * the panel and not to tasks the model created through manageTask. The same
 * scores produced different priorities depending on the door they came in
 * through. Here both callers can reach it.
 */
export function derivePriority(
  consequence: number,
  impact: number,
): 'low' | 'medium' | 'high' | 'urgent' {
  const score = consequence * impact;
  if (score >= 20) return 'urgent';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

const task = ({ strapi }: { strapi: Core.Strapi }) => {
  const records = ownedRecords(strapi, {
    uid: 'plugin::ai-chat.task',
    fields: ['title', 'description', 'status', 'priority', 'consequence', 'impact', 'dueDate', 'createdAt'],
    sort: { createdAt: 'desc' },
    defaults: { status: 'open', consequence: 3, impact: 3 },
    writable: ['title', 'description', 'status', 'consequence', 'impact', 'dueDate'],
  });

  /** Priority is derived, never accepted from the caller. */
  const withPriority = (input: Record<string, unknown>, fallback?: Record<string, unknown>) => {
    const consequence = Number(input.consequence ?? fallback?.consequence ?? 3);
    const impact = Number(input.impact ?? fallback?.impact ?? 3);
    return { ...input, priority: derivePriority(consequence, impact) };
  };

  return {
    list: records.list,
    remove: records.remove,
    clear: records.clear,

    async create(adminUserId: number, input: Record<string, unknown>) {
      return records.create(adminUserId, withPriority(input));
    },

    async update(adminUserId: number, documentId: string, input: Record<string, unknown>) {
      // Re-derive from the merged result, so changing only impact still
      // recomputes against the stored consequence.
      const existing = await strapi
        .documents('plugin::ai-chat.task' as any)
        .findOne({ documentId });

      return records.update(adminUserId, documentId, withPriority(input, existing as any));
    },
  };
};

export default task;
