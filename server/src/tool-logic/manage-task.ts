import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolContext } from '../lib/tool-registry';

const CONTENT_TYPE = 'plugin::ai-chat.task' as const;

export const manageTaskSchema = z.object({
  action: z.enum(['create', 'update', 'complete', 'list', 'summary']).describe(
    'Action to perform: create a new task, update an existing task, complete (mark done), list open tasks, or get a summary.'
  ),
  documentId: z.string().optional().describe('Document ID of the task to update or complete. If not known, provide title instead — the system will search for a matching task.'),
  title: z.string().optional().describe('Task title — short, clear action. For update/complete: used to find the task if documentId is not provided.'),
  description: z.string().optional().describe('Brief context or why this matters.'),
  content: z.string().optional().describe('Detailed notes, steps, or links (markdown).'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Priority level. Default: medium.'),
  consequence: z.number().int().min(1).max(5).optional().describe('1-5: What happens if this is NOT done? Do NOT ask the user — omit this and a UI form will collect it.'),
  impact: z.number().int().min(1).max(5).optional().describe('1-5: How much does completing this move the needle? Do NOT ask the user — omit this and a UI form will collect it.'),
  dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format.'),
  done: z.boolean().optional().describe('Set done status explicitly (for update action).'),
  filters: z.record(z.string(), z.unknown()).optional().describe('Additional Strapi filters for list action.'),
});

export const manageTaskDescription =
  'Manage the user\'s task list. Actions: create (new task), update (modify fields), complete (mark done), list (open tasks sorted by priority score), summary (overview with overdue/urgent counts). Tasks are scored by consequence × impact to prioritize what matters most. For create: title is required; consequence and impact are collected via UI form if omitted.';

export type ManageTaskParams = z.infer<typeof manageTaskSchema>;

export interface ManageTaskResult {
  success: boolean;
  message: string;
  status?: 'pending_confirmation';
  proposed?: {
    title: string;
    description?: string;
    content?: string;
    priority: string;
    dueDate: string | null;
  };
  data?: unknown;
}

/**
 * Resolve a task by documentId (exact) or title (fuzzy search).
 * Returns the task document or null.
 */
async function resolveTask(
  strapi: Core.Strapi,
  adminUserId: number,
  documentId?: string,
  title?: string,
): Promise<any | null> {
  // Try documentId first
  if (documentId) {
    const task = await strapi.documents(CONTENT_TYPE).findOne({ documentId });
    if (task && task.adminUserId === adminUserId) return task;
  }

  // Fall back to title search
  if (title) {
    const tasks = await strapi.documents(CONTENT_TYPE).findMany({
      filters: {
        adminUserId,
        title: { $containsi: title },
      },
    });
    if ((tasks as any[]).length === 1) return (tasks as any[])[0];
    if ((tasks as any[]).length > 1) {
      // Try exact match first
      const exact = (tasks as any[]).find(
        (t: any) => t.title.toLowerCase() === title.toLowerCase()
      );
      if (exact) return exact;
      // Return the most recent one
      return (tasks as any[]).sort(
        (a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt)
      )[0];
    }
  }

  return null;
}

export async function manageTask(
  strapi: Core.Strapi,
  params: ManageTaskParams,
  context?: ToolContext
): Promise<ManageTaskResult> {
  if (!context?.adminUserId) {
    return { success: false, message: 'Cannot manage tasks: user context not available.' };
  }

  const adminUserId = context.adminUserId;

  try {
    switch (params.action) {
      case 'create': {
        if (!params.title) {
          return { success: false, message: 'Title is required to create a task.' };
        }
        if (params.consequence == null || params.impact == null) {
          return {
            success: false,
            status: 'pending_confirmation',
            message: 'A confirmation form has been shown to the user in the chat. They will set consequence and impact scores and confirm. Do NOT re-call this tool — the task will be created when the user confirms.',
            proposed: {
              title: params.title,
              description: params.description,
              content: params.content,
              priority: params.priority ?? 'medium',
              dueDate: params.dueDate ?? null,
            },
          };
        }
        // Check for duplicate — if a similar open task exists, update it instead
        const duplicate = await resolveTask(strapi, adminUserId, undefined, params.title);
        if (duplicate && !duplicate.done) {
          const data: Record<string, unknown> = {};
          if (params.description !== undefined) data.description = params.description;
          if (params.content !== undefined) data.content = params.content;
          if (params.priority !== undefined) data.priority = params.priority;
          if (params.consequence !== undefined) data.consequence = params.consequence;
          if (params.impact !== undefined) data.impact = params.impact;
          if (params.dueDate !== undefined) data.dueDate = params.dueDate;
          const updated = await strapi.documents(CONTENT_TYPE).update({
            documentId: duplicate.documentId,
            data: data as any,
          });
          const score = (updated.consequence ?? 3) * (updated.impact ?? 3);
          return {
            success: true,
            message: `A similar task already existed ("${duplicate.title}") — updated it instead of creating a duplicate. (priority: ${updated.priority}, score: ${score})`,
            data: updated,
          };
        }
        const task = await strapi.documents(CONTENT_TYPE).create({
          data: {
            title: params.title,
            description: params.description,
            content: params.content,
            done: false,
            priority: params.priority ?? 'medium',
            consequence: params.consequence ?? 3,
            impact: params.impact ?? 3,
            dueDate: params.dueDate,
            adminUserId,
          },
        });
        const score = (task.consequence ?? 3) * (task.impact ?? 3);
        return {
          success: true,
          message: `Task created: "${task.title}" (priority: ${task.priority}, score: ${score})`,
          data: task,
        };
      }

      case 'update': {
        const existing = await resolveTask(strapi, adminUserId, params.documentId, params.title);
        if (!existing) {
          return { success: false, message: 'Task not found. Provide a documentId or a title to search by.' };
        }
        const data: Record<string, unknown> = {};
        for (const key of ['title', 'description', 'content', 'priority', 'consequence', 'impact', 'dueDate', 'done'] as const) {
          if (params[key] !== undefined) data[key] = params[key];
        }
        const updated = await strapi.documents(CONTENT_TYPE).update({
          documentId: existing.documentId,
          data: data as any,
        });
        return { success: true, message: `Task updated: "${updated.title}"`, data: updated };
      }

      case 'complete': {
        const toComplete = await resolveTask(strapi, adminUserId, params.documentId, params.title);
        if (!toComplete) {
          return { success: false, message: 'Task not found. Provide a documentId or a title to search by.' };
        }
        await strapi.documents(CONTENT_TYPE).update({
          documentId: toComplete.documentId,
          data: { done: true } as any,
        });
        return { success: true, message: `Task completed: "${toComplete.title}"` };
      }

      case 'list': {
        const filters: Record<string, unknown> = {
          adminUserId,
          done: false,
          ...params.filters,
        };
        const tasks = await strapi.documents(CONTENT_TYPE).findMany({
          filters,
        });

        // Sort by consequence × impact desc, then dueDate asc
        const sorted = (tasks as any[]).sort((a, b) => {
          const scoreA = (a.consequence ?? 3) * (a.impact ?? 3);
          const scoreB = (b.consequence ?? 3) * (b.impact ?? 3);
          if (scoreB !== scoreA) return scoreB - scoreA;
          // Due date: tasks with dates first, then by date asc
          if (a.dueDate && !b.dueDate) return -1;
          if (!a.dueDate && b.dueDate) return 1;
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          return 0;
        });

        return {
          success: true,
          message: `Found ${sorted.length} open task(s).`,
          data: sorted.map((t: any) => ({
            documentId: t.documentId,
            title: t.title,
            description: t.description,
            priority: t.priority,
            consequence: t.consequence,
            impact: t.impact,
            score: (t.consequence ?? 3) * (t.impact ?? 3),
            dueDate: t.dueDate,
            done: t.done,
          })),
        };
      }

      case 'summary': {
        const allOpen = await strapi.documents(CONTENT_TYPE).findMany({
          filters: { adminUserId, done: false },
        });

        const today = new Date().toISOString().split('T')[0];
        const overdue = (allOpen as any[]).filter(
          (t: any) => t.dueDate && t.dueDate < today
        );

        const scored = (allOpen as any[])
          .map((t: any) => ({
            documentId: t.documentId,
            title: t.title,
            priority: t.priority,
            consequence: t.consequence ?? 3,
            impact: t.impact ?? 3,
            score: (t.consequence ?? 3) * (t.impact ?? 3),
            dueDate: t.dueDate,
          }))
          .sort((a, b) => b.score - a.score);

        const urgent = scored.filter((t) => t.priority === 'urgent');

        return {
          success: true,
          message: 'Task summary generated.',
          data: {
            totalOpen: allOpen.length,
            overdueCount: overdue.length,
            overdueTasks: overdue.map((t: any) => ({ documentId: t.documentId, title: t.title, dueDate: t.dueDate })),
            urgentTasks: urgent,
            top3: scored.slice(0, 3),
          },
        };
      }

      default:
        return { success: false, message: `Unknown action: ${params.action}` };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Task operation failed: ${detail}` };
  }
}
