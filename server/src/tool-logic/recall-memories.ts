import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolContext } from '../lib/tool-registry';

const CONTENT_TYPE = 'plugin::ai-chat.memory' as const;

export const recallMemoriesSchema = z.object({
  query: z.string().optional().describe('Optional search term to filter memories by content'),
  category: z.string().optional().describe('Optional category to filter by (e.g. "preference", "project", "personal")'),
});

export const recallMemoriesDescription =
  'Recall saved memories/facts about the user. Use this to look up previously saved information. Without parameters, returns all memories.';

export type RecallMemoriesParams = z.infer<typeof recallMemoriesSchema>;

export interface RecallMemoriesResult {
  success: boolean;
  memories: { content: string; category: string }[];
  count: number;
}

export async function recallMemories(
  strapi: Core.Strapi,
  params: RecallMemoriesParams,
  context?: ToolContext
): Promise<RecallMemoriesResult> {
  if (!context?.adminUserId) {
    return { success: false, memories: [], count: 0 };
  }

  try {
    const filters: Record<string, unknown> = { adminUserId: context.adminUserId };
    if (params.category) {
      filters.category = params.category;
    }
    if (params.query) {
      filters.content = { $containsi: params.query };
    }

    const memories = await strapi.documents(CONTENT_TYPE).findMany({
      filters,
      fields: ['content', 'category'],
      sort: { createdAt: 'desc' },
    });

    return {
      success: true,
      memories: memories.map((m: any) => ({ content: m.content, category: m.category })),
      count: memories.length,
    };
  } catch (error) {
    return { success: false, memories: [], count: 0 };
  }
}
