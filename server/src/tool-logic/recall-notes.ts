import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolContext } from '../lib/tool-registry';

const CONTENT_TYPE = 'plugin::ai-chat.note' as const;

export const recallNotesSchema = z.object({
  query: z.string().optional().describe('Optional search term to filter notes by title or content'),
  category: z.string().optional().describe('Optional category to filter by: "research", "snippet", "idea", "reference"'),
  tag: z.string().optional().describe('Optional tag to filter by (matches within comma-separated tags)'),
});

export const recallNotesDescription =
  'Recall saved research notes, snippets, ideas, and references. Use this to look up previously saved notes. Without parameters, returns all notes.';

export type RecallNotesParams = z.infer<typeof recallNotesSchema>;

export interface RecallNotesResult {
  success: boolean;
  notes: { title: string; content: string; category: string; tags: string; source: string }[];
  count: number;
}

export async function recallNotes(
  strapi: Core.Strapi,
  params: RecallNotesParams,
  context?: ToolContext
): Promise<RecallNotesResult> {
  if (!context?.adminUserId) {
    return { success: false, notes: [], count: 0 };
  }

  try {
    const filters: Record<string, unknown> = { adminUserId: context.adminUserId };
    if (params.category) {
      filters.category = params.category;
    }
    if (params.query) {
      filters.$or = [
        { title: { $containsi: params.query } },
        { content: { $containsi: params.query } },
      ];
    }
    if (params.tag) {
      filters.tags = { $containsi: params.tag };
    }

    const notes = await strapi.documents(CONTENT_TYPE).findMany({
      filters,
      fields: ['title', 'content', 'category', 'tags', 'source'],
      sort: { createdAt: 'desc' },
    });

    return {
      success: true,
      notes: notes.map((n: any) => ({
        title: n.title || '',
        content: n.content,
        category: n.category,
        tags: n.tags || '',
        source: n.source || '',
      })),
      count: notes.length,
    };
  } catch (error) {
    return { success: false, notes: [], count: 0 };
  }
}
