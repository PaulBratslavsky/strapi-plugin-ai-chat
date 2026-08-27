import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolContext } from '../lib/tool-registry';

const CONTENT_TYPE = 'plugin::ai-chat.note' as const;

export const saveNoteSchema = z.object({
  title: z.string().optional().describe('A short title or label for the note'),
  content: z.string().describe('The note content in markdown format. Can include code blocks, lists, links, etc.'),
  category: z.string().optional().describe('Category for the note: "research", "snippet", "idea", or "reference". Defaults to "research".'),
  tags: z.string().optional().describe('Comma-separated tags for filtering (e.g. "strapi, api, tutorial")'),
  source: z.string().optional().describe('Where this note came from (e.g. "conversation", "web research", a URL)'),
});

export const saveNoteDescription =
  'Save a research note, code snippet, idea, or reference for the user. Use this when the user wants to save part of a conversation, research findings, code examples, or any content they may want to use later for writing blog posts or articles. Content is saved as markdown.';

export type SaveNoteParams = z.infer<typeof saveNoteSchema>;

export interface SaveNoteResult {
  success: boolean;
  message: string;
}

export async function saveNote(
  strapi: Core.Strapi,
  params: SaveNoteParams,
  context?: ToolContext
): Promise<SaveNoteResult> {
  if (!context?.adminUserId) {
    return { success: false, message: 'Cannot save note: user context not available.' };
  }

  try {
    await strapi.documents(CONTENT_TYPE).create({
      data: {
        title: params.title || '',
        content: params.content,
        category: params.category || 'research',
        tags: params.tags || '',
        source: params.source || 'conversation',
        adminUserId: context.adminUserId,
      },
    });

    const label = params.title ? `"${params.title}"` : 'Note';
    return { success: true, message: `${label} saved to research notes.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to save note: ${detail}` };
  }
}
