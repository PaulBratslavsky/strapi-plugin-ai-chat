import type { Core } from '@strapi/strapi';
import { z } from 'zod';

const CONTENT_TYPE = 'plugin::ai-sdk.public-memory' as const;

export const recallPublicMemoriesSchema = z.object({
  query: z.string().optional().describe('Optional search term to filter public memories by content'),
  category: z.string().optional().describe('Optional category to filter by (e.g. "faq", "product", "policy")'),
});

export const recallPublicMemoriesDescription =
  'Recall shared team knowledge. These memories are visible to every admin in this project, unlike recallMemories which returns only the calling admin\'s own notes. Use it for facts the whole team relies on: product details, policies, conventions.';

export type RecallPublicMemoriesParams = z.infer<typeof recallPublicMemoriesSchema>;

export interface RecallPublicMemoriesResult {
  success: boolean;
  memories: { content: string; category: string }[];
  count: number;
}

export async function recallPublicMemories(
  strapi: Core.Strapi,
  params: RecallPublicMemoriesParams
): Promise<RecallPublicMemoriesResult> {
  try {
    const filters: Record<string, unknown> = {};
    if (params.category) filters.category = params.category;
    if (params.query) filters.content = { $containsi: params.query };

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
