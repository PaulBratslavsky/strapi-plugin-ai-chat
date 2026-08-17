import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { jsonCoercible } from '../lib/json-coercible';

export const updateContentSchema = z.object({
  contentType: z
    .string()
    .describe('Content type UID, e.g. "api::article.article"'),
  documentId: z
    .string()
    .describe('The document ID to update'),
  data: jsonCoercible(z.record(z.string(), z.unknown()))
    .describe('The field values to set. Must match the content type schema.'),
  status: z
    .enum(['draft', 'published'])
    .optional()
    .describe('Document status. Defaults to draft.'),
  locale: z
    .string()
    .optional()
    .describe('Locale code for i18n content, e.g. "en" or "fr"'),
});

export const updateContentDescription =
  'Update an existing document in any Strapi content type. Requires contentType, documentId, and data (fields to change — only include fields you want to modify). Typical workflow: searchContent to find the documentId, then updateContent to modify it. Returns the updated document.';

export interface UpdateContentParams {
  contentType: string;
  documentId: string;
  data: Record<string, unknown>;
  status?: 'draft' | 'published';
  locale?: string;
}

export interface UpdateContentResult {
  action: 'update';
  document: any;
}

/**
 * Core logic for updating content.
 * Shared between AI SDK tool and MCP tool.
 */
export async function updateContent(
  strapi: Core.Strapi,
  params: UpdateContentParams
): Promise<UpdateContentResult> {
  const { contentType, documentId, data, status, locale } = params;

  if (!strapi.contentTypes[contentType as keyof typeof strapi.contentTypes]) {
    throw new Error(`Content type "${contentType}" does not exist.`);
  }

  const docs = strapi.documents(contentType as any);

  // Verify document exists before updating
  const existing = await docs.findOne({
    documentId,
    ...(locale ? { locale } : {}),
  } as any);

  if (!existing) {
    throw new Error(
      `Document with ID "${documentId}" not found in "${contentType}".`
    );
  }

  const document = await docs.update({
    documentId,
    data,
    ...(status ? { status } : {}),
    ...(locale ? { locale } : {}),
    populate: '*',
  } as any);

  return { action: 'update', document };
}
