import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolContext } from '../lib/tool-registry';

const CONTENT_TYPE = 'plugin::ai-chat.memory' as const;

export const saveMemorySchema = z.object({
  content: z.string().describe('A short, factual statement to remember about the user (e.g. "User prefers dark mode", "Company name is Acme Corp")'),
  category: z.string().optional().describe('Category for the memory (e.g. "preference", "project", "personal", "general"). Defaults to "general".'),
});

export const saveMemoryDescription =
  'Save a fact or preference about the user to long-term memory. Use this proactively when the user shares personal information, preferences, or important context that would be useful in future conversations. Keep each memory concise and factual.';

export type SaveMemoryParams = z.infer<typeof saveMemorySchema>;

export interface SaveMemoryResult {
  success: boolean;
  message: string;
}

export async function saveMemory(
  strapi: Core.Strapi,
  params: SaveMemoryParams,
  context?: ToolContext
): Promise<SaveMemoryResult> {
  if (!context?.adminUserId) {
    return { success: false, message: 'Cannot save memory: user context not available.' };
  }

  try {
    await strapi.documents(CONTENT_TYPE).create({
      data: {
        content: params.content,
        category: params.category || 'general',
        adminUserId: context.adminUserId,
      },
    });

    return { success: true, message: `Memory saved: "${params.content}"` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to save memory: ${detail}` };
  }
}
