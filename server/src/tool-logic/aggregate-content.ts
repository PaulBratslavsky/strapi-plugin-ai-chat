import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { jsonCoercible } from '../lib/json-coercible';
import { resolveFieldPath } from './schema-utils';
import type { ResolvedField } from './schema-utils';

const MAX_PAGINATE = 1000;
const PAGE_SIZE = 100;

export const aggregateContentSchema = z.object({
  contentType: z
    .string()
    .describe('The content type UID, e.g. "api::article.article"'),
  operation: z
    .enum(['count', 'countByField', 'countByDateRange'])
    .describe(
      'count — total count; countByField — group by a field; countByDateRange — bucket by date'
    ),
  filters: jsonCoercible(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Strapi filter object. Scalar: { title: { $containsi: "hello" } }. Relation: { author: { name: { $eq: "John" } } }. ManyToMany: { contentTags: { title: { $eq: "tutorial" } } }.'),
  groupByField: z
    .string()
    .optional()
    .describe('Field to group by for countByField. Just use the field name — relation fields are auto-resolved to their display name (e.g. "author", "category"). You can also use dot paths like "author.email" for a specific sub-field.'),
  dateField: z
    .string()
    .optional()
    .default('createdAt')
    .describe('Date field for countByDateRange (default: "createdAt")'),
  granularity: z
    .enum(['day', 'week', 'month'])
    .optional()
    .default('month')
    .describe('Bucket granularity for countByDateRange'),
  dateFrom: z
    .string()
    .optional()
    .describe('ISO date string lower bound (inclusive)'),
  dateTo: z
    .string()
    .optional()
    .describe('ISO date string upper bound (inclusive)'),
  status: z
    .enum(['draft', 'published'])
    .optional()
    .describe('Filter by document status'),
  locale: z
    .string()
    .optional()
    .describe('Locale code for i18n content'),
});

export const aggregateContentDescription =
  'Count and group content entries for analytics. Answers questions like "how many articles?", "posts per category", "content published by month". Three operations: count (total), countByField (group by a field), countByDateRange (bucket by day/week/month). Prefer this over searchContent when you need counts or distributions, not the documents themselves.';

export interface AggregateContentParams {
  contentType: string;
  operation: 'count' | 'countByField' | 'countByDateRange';
  filters?: Record<string, unknown>;
  groupByField?: string;
  dateField?: string;
  granularity?: 'day' | 'week' | 'month';
  dateFrom?: string;
  dateTo?: string;
  status?: 'draft' | 'published';
  locale?: string;
}

export interface AggregateContentResult {
  total?: number;
  groups?: { value: string; count: number }[];
  buckets?: { period: string; count: number }[];
  /** The field path actually used (after schema auto-resolution) */
  resolvedField?: string;
}

function buildBaseQuery(params: AggregateContentParams) {
  const { filters, status, locale, dateFrom, dateTo, dateField = 'createdAt' } = params;
  const query: Record<string, unknown> = {};
  const mergedFilters: Record<string, unknown> = { ...filters };

  if (dateFrom || dateTo) {
    const dateFilter: Record<string, string> = {};
    if (dateFrom) dateFilter.$gte = dateFrom;
    if (dateTo) dateFilter.$lte = dateTo;
    mergedFilters[dateField] = dateFilter;
  }

  if (Object.keys(mergedFilters).length > 0) query.filters = mergedFilters;
  if (status) query.status = status;
  if (locale) query.locale = locale;

  return query;
}

/**
 * Resolve a potentially nested field path (e.g. "category.name") from a document.
 */
function resolveField(doc: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = doc;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    // Don't traverse into arrays — return the array for the caller to handle
    if (Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Build a targeted Strapi populate object for specific relations.
 * Falls back to '*' when no specific relations are needed.
 */
function buildPopulate(resolved: ResolvedField): string | Record<string, unknown> {
  if (resolved.populate.length === 0) return '*';

  const populate: Record<string, unknown> = {};
  for (const rel of resolved.populate) {
    if (resolved.selectField) {
      populate[rel] = { fields: [resolved.selectField] };
    } else {
      populate[rel] = true;
    }
  }
  return populate;
}

/**
 * Paginate through all matching documents with a specific populate.
 */
async function paginateAll(
  strapi: Core.Strapi,
  contentType: string,
  baseQuery: Record<string, unknown>,
  populate: string | Record<string, unknown> = '*',
): Promise<Record<string, unknown>[]> {
  const docs: Record<string, unknown>[] = [];
  let page = 1;

  while (docs.length < MAX_PAGINATE) {
    const results = await strapi.documents(contentType as any).findMany({
      ...baseQuery,
      populate,
      page,
      pageSize: PAGE_SIZE,
    } as any);

    if (!results || results.length === 0) break;
    docs.push(...results);
    if (results.length < PAGE_SIZE) break;
    page++;
  }

  return docs;
}

/** Display-name candidates for relation objects (checked in order) */
const DISPLAY_CANDIDATES = ['name', 'title', 'username', 'label', 'slug', 'email'];

/**
 * Extract a human-readable string from a single value.
 */
function toDisplayValue(raw: unknown): string {
  if (raw == null) return '(empty)';
  if (typeof raw !== 'object') return String(raw);

  // Single relation object — pick best display field
  const obj = raw as Record<string, unknown>;
  for (const key of DISPLAY_CANDIDATES) {
    if (obj[key] != null) return String(obj[key]);
  }
  return obj.id != null ? String(obj.id) : '(empty)';
}

/**
 * Group documents by a resolved field path and return sorted counts.
 *
 * For manyToMany relations (isArray=true), each related item is counted separately.
 * e.g. an article tagged ["tutorial", "strapi"] counts once for each tag.
 */
function groupDocs(
  docs: Record<string, unknown>[],
  resolved: ResolvedField,
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  const topField = resolved.resolvedPath.split('.')[0];
  const subPath = resolved.resolvedPath.split('.').slice(1).join('.');

  for (const doc of docs) {
    if (resolved.isArray) {
      // manyToMany / oneToMany — the top-level field is an array of related objects
      const items = doc[topField];
      if (!Array.isArray(items) || items.length === 0) {
        counts.set('(empty)', (counts.get('(empty)') ?? 0) + 1);
        continue;
      }
      for (const item of items) {
        let value: string;
        if (subPath && typeof item === 'object' && item != null) {
          const sub = resolveField(item as Record<string, unknown>, subPath);
          value = sub != null ? String(sub) : toDisplayValue(item);
        } else {
          value = toDisplayValue(item);
        }
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    } else {
      // Scalar or manyToOne — single value per document
      const raw = resolveField(doc, resolved.resolvedPath);
      const value = toDisplayValue(raw);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function getWeekKey(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function getBucketKey(dateStr: string, granularity: 'day' | 'week' | 'month'): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'unknown';

  switch (granularity) {
    case 'day':
      return date.toISOString().slice(0, 10);
    case 'week':
      return getWeekKey(date);
    case 'month':
      return date.toISOString().slice(0, 7);
  }
}

export async function aggregateContent(
  strapi: Core.Strapi,
  params: AggregateContentParams
): Promise<AggregateContentResult> {
  const { contentType, operation } = params;

  if (!strapi.contentTypes[contentType as keyof typeof strapi.contentTypes]) {
    throw new Error(`Content type "${contentType}" does not exist.`);
  }

  const baseQuery = buildBaseQuery(params);

  switch (operation) {
    case 'count': {
      const total = await strapi.documents(contentType as any).count(baseQuery as any);
      return { total };
    }

    case 'countByField': {
      const { groupByField } = params;
      if (!groupByField) {
        throw new Error('groupByField is required for countByField operation');
      }

      // Auto-resolve relation fields using the runtime schema
      // e.g. "author" → "author.name", "contentTags" → "contentTags.title"
      const resolved = resolveFieldPath(strapi, contentType, groupByField);
      const populate = buildPopulate(resolved);

      const docs = await paginateAll(strapi, contentType, baseQuery, populate);
      const groups = groupDocs(docs, resolved);

      return { total: docs.length, groups, resolvedField: resolved.resolvedPath };
    }

    case 'countByDateRange': {
      const { dateField = 'createdAt', granularity = 'month' } = params;

      const docs = await paginateAll(strapi, contentType, baseQuery);
      const counts = new Map<string, number>();

      for (const doc of docs) {
        const raw = resolveField(doc, dateField);
        if (!raw) continue;
        const key = getBucketKey(String(raw), granularity);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      const buckets = Array.from(counts.entries())
        .map(([period, count]) => ({ period, count }))
        .sort((a, b) => a.period.localeCompare(b.period));

      return { total: docs.length, buckets };
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}
