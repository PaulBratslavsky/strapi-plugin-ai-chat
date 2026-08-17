import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { jsonCoercible } from '../lib/json-coercible';

const MAX_PAGE_SIZE = 50;

const LARGE_CONTENT_FIELDS = new Set(['content', 'blocks', 'body', 'richText', 'markdown', 'html']);

export const searchContentSchema = z.object({
  contentType: z
    .string()
    .describe(
      'The content type UID to search, e.g. "api::article.article" or "plugin::users-permissions.user"'
    ),
  query: z
    .string()
    .optional()
    .describe('Full-text search query string (searches across all searchable text fields)'),
  filters: jsonCoercible(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Strapi filter object. Scalar: { title: { $containsi: "hello" } }. Relation: { author: { name: { $eq: "John" } } }. ManyToMany: { contentTags: { title: { $eq: "tutorial" } } }. Operators: $eq, $ne, $containsi, $in, $gt, $lt, $gte, $lte, $null, $notNull.'),
  fields: jsonCoercible(z.array(z.string()))
    .optional()
    .describe('Specific fields to return. If omitted, returns all fields (large content fields stripped unless includeContent is true).'),
  sort: z
    .string()
    .optional()
    .describe('Sort order, e.g. "createdAt:desc"'),
  page: z.number().optional().default(1).describe('Page number (starts at 1)'),
  pageSize: z
    .number()
    .optional()
    .default(10)
    .describe(`Results per page (max ${MAX_PAGE_SIZE})`),
  status: z
    .enum(['draft', 'published'])
    .optional()
    .describe('Filter by document status. Published documents have a publishedAt date. If omitted, Strapi returns drafts by default.'),
  locale: z
    .string()
    .optional()
    .describe('Locale code for i18n content, e.g. "en" or "fr"'),
  populate: jsonCoercible(
    z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  )
    .optional()
    .describe('Relations to populate. Defaults to "*" (all). Can be a string, array, or object.'),
  includeContent: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, includes large content fields (content, blocks, body, etc.) in results. Default false to reduce context size.'),
});

export const searchContentDescription =
  'Search and query any Strapi content type. Use listContentTypes first to discover available content types and their fields, then use this tool to query specific collections. Use sort (e.g. "createdAt:desc") and pageSize: 1 to get the latest entry. By default, large content fields are stripped from results — set includeContent to true or use fields to get full content. To filter by a relation, nest the filter: { relationField: { fieldOnRelation: { $operator: "value" } } }.';

export interface SearchContentParams {
  contentType: string;
  query?: string;
  filters?: Record<string, unknown>;
  fields?: string[];
  sort?: string;
  page?: number;
  pageSize?: number;
  status?: 'draft' | 'published';
  locale?: string;
  populate?: string | string[] | Record<string, unknown>;
  includeContent?: boolean;
}

export interface SearchContentResult {
  results: any[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

function stripLargeFields(obj: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (LARGE_CONTENT_FIELDS.has(key)) {
      continue;
    }
    stripped[key] = value;
  }
  return stripped;
}

/**
 * Core logic for searching content.
 * Shared between AI SDK tool and MCP tool.
 */
export async function searchContent(
  strapi: Core.Strapi,
  params: SearchContentParams
): Promise<SearchContentResult> {
  const {
    contentType,
    query,
    filters,
    fields,
    sort,
    page = 1,
    pageSize = 10,
    status,
    locale,
    populate = '*',
    includeContent = false,
  } = params;

  if (!strapi.contentTypes[contentType as keyof typeof strapi.contentTypes]) {
    throw new Error(`Content type "${contentType}" does not exist.`);
  }

  const clampedPageSize = Math.min(pageSize, MAX_PAGE_SIZE);

  const results = await strapi.documents(contentType as any).findMany({
    ...(query ? { _q: query } : {}),
    ...(filters ? { filters } : {}),
    ...(fields ? { fields } : {}),
    ...(sort ? { sort } : {}),
    ...(status ? { status } : {}),
    ...(locale ? { locale } : {}),
    page,
    pageSize: clampedPageSize,
    populate,
  } as any);

  const total = await strapi.documents(contentType as any).count({
    ...(query ? { _q: query } : {}),
    ...(filters ? { filters } : {}),
    ...(status ? { status } : {}),
    ...(locale ? { locale } : {}),
  } as any);

  // Strip large content fields unless explicitly requested or fields are specified
  const shouldStrip = !includeContent && !fields;
  const processedResults = shouldStrip
    ? results.map((doc: any) => stripLargeFields(doc))
    : results;

  return {
    results: processedResults,
    pagination: {
      page,
      pageSize: clampedPageSize,
      total,
    },
  };
}
