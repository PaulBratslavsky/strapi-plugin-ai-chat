import type { Core } from '@strapi/strapi';
import { z } from 'zod';

export const listContentTypesSchema = z.object({});

export const listContentTypesDescription =
  'List all Strapi content types and components with their fields, relations, and structure. This is the starting point for any content operation — call it first to discover content type UIDs (e.g. "api::article.article"), field names, relation targets, and components. Each field reports its type and any constraints it carries (required, maxLength, minLength, enum, default) - respect them when writing, since a violation is rejected. No parameters required. Results are cached.';

export interface RelationSummary {
  field: string;
  type: string;
  target: string;
  targetDisplayName: string;
}

/**
 * One field, with the constraints a model has to respect in order to write it.
 *
 * Names alone were not enough. A model told only that `description` exists will
 * send 90 characters to a field capped at 80, and the only feedback is a
 * rejected write it then has to guess its way out of. Strong models absorb that
 * round trip; smaller ones spend their one attempt on it and either give up or
 * report a save that never happened.
 *
 * Every property past `name` and `type` is omitted when the attribute does not
 * set it, so the common field costs two keys rather than eight.
 */
export interface FieldSummary {
  name: string;
  type: string;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  enum?: string[];
  default?: unknown;
}

export interface ContentTypeSummary {
  uid: string;
  kind: 'collectionType' | 'singleType';
  displayName: string;
  fields: FieldSummary[];
  relations: RelationSummary[];
  components: string[];
}

export interface ComponentSummary {
  uid: string;
  category: string;
  displayName: string;
  fieldCount: number;
  fields: FieldSummary[];
}

export interface ListContentTypesResult {
  contentTypes: ContentTypeSummary[];
  components: ComponentSummary[];
}

interface StrapiContentType {
  kind?: string;
  info?: { displayName?: string };
  attributes?: Record<string, Record<string, unknown>>;
}

interface StrapiComponent {
  category?: string;
  info?: { displayName?: string };
  attributes?: Record<string, unknown>;
}

const INTERNAL_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);

function isApiContentType(uid: string): boolean {
  return !uid.startsWith('admin::') && !uid.startsWith('strapi::');
}

function extractRelation(
  attrName: string,
  attr: Record<string, unknown>,
  contentTypes: object
): RelationSummary | null {
  if (attr.type !== 'relation' || !attr.target) return null;

  const target = attr.target as string;
  const relation = attr.relation as string;
  const targetCt = (contentTypes as Record<string, StrapiContentType>)[target];
  return {
    field: attrName,
    type: relation,
    target,
    targetDisplayName: targetCt?.info?.displayName || target,
  };
}

function collectComponents(attr: Record<string, unknown>): string[] {
  if (attr.type === 'component' && attr.component) {
    return [attr.component as string];
  }
  if (attr.type === 'dynamiczone' && Array.isArray(attr.components)) {
    return attr.components as string[];
  }
  return [];
}

/** Read the constraints Strapi records on an attribute, skipping the unset. */
function summarizeField(name: string, attrDef: unknown): FieldSummary {
  const attr = (attrDef ?? {}) as Record<string, unknown>;
  const summary: FieldSummary = { name, type: (attr.type as string) ?? 'unknown' };

  if (attr.required === true) summary.required = true;
  if (typeof attr.maxLength === 'number') summary.maxLength = attr.maxLength;
  if (typeof attr.minLength === 'number') summary.minLength = attr.minLength;
  if (Array.isArray(attr.enum)) summary.enum = attr.enum as string[];
  if (attr.default !== undefined) summary.default = attr.default;

  return summary;
}

function parseContentType(
  uid: string,
  contentType: unknown,
  allContentTypes: object
): ContentTypeSummary {
  const ct = contentType as StrapiContentType;
  const fields: FieldSummary[] = [];
  const relations: RelationSummary[] = [];
  const usedComponents = new Set<string>();

  for (const [attrName, attrDef] of Object.entries(ct.attributes || {})) {
    if (INTERNAL_FIELDS.has(attrName)) continue;

    fields.push(summarizeField(attrName, attrDef));

    const relation = extractRelation(attrName, attrDef, allContentTypes);
    if (relation) relations.push(relation);

    for (const comp of collectComponents(attrDef)) {
      usedComponents.add(comp);
    }
  }

  return {
    uid,
    kind: (ct.kind || 'collectionType') as 'collectionType' | 'singleType',
    displayName: ct.info?.displayName || uid,
    fields,
    relations,
    components: [...usedComponents],
  };
}

function parseComponent(uid: string, component: unknown): ComponentSummary {
  const comp = component as StrapiComponent;
  return {
    uid,
    category: comp.category || 'default',
    displayName: comp.info?.displayName || uid,
    fieldCount: Object.keys(comp.attributes || {}).length,
    fields: Object.entries(comp.attributes || {}).map(([n, d]) => summarizeField(n, d)),
  };
}

// Cache — content types don't change at runtime so we compute once
let cachedResult: ListContentTypesResult | null = null;

/**
 * Core logic for listing content types and components.
 * Shared between AI SDK tool and MCP tool.
 * Results are cached since content types are static after server startup.
 */
export async function listContentTypes(strapi: Core.Strapi): Promise<ListContentTypesResult> {
  if (cachedResult) return cachedResult;

  const contentTypes = Object.entries(strapi.contentTypes)
    .filter(([uid]) => isApiContentType(uid))
    .map(([uid, ct]) => parseContentType(uid, ct, strapi.contentTypes))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const components = Object.entries(strapi.components)
    .map(([uid, comp]) => parseComponent(uid, comp))
    .sort((a, b) => a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName));

  cachedResult = { contentTypes, components };
  return cachedResult;
}
