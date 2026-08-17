import type { ToolRegistry, ToolDefinition } from '../../lib/tool-registry';

/** Convert camelCase to snake_case, matching the MCP server's naming convention */
function toSnakeCase(str: string): string {
  return str
    .replace(/:/g, '__')
    .replace(/-/g, '_')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Extract a human-readable type string from a Zod field.
 * Handles the common types used in tool schemas.
 */
function extractType(field: any): string {
  const def = field?._zod?.def ?? field?.def;
  if (!def) return 'unknown';

  switch (def.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return def.entries ? Object.keys(def.entries).join(' | ') : 'enum';
    case 'optional':
      return extractType(def.innerType);
    case 'default':
      return extractType(def.innerType);
    case 'record':
      return 'object';
    case 'array':
      return 'array';
    case 'union':
      return 'string | array | object';
    default:
      return def.type || 'unknown';
  }
}

/**
 * Format a single tool's parameters as a markdown table.
 */
function formatParams(schema: any): string {
  const shape = schema.shape;
  if (!shape || Object.keys(shape).length === 0) {
    return '_No parameters._\n';
  }

  const rows: string[] = [];
  rows.push('| Parameter | Type | Required | Description |');
  rows.push('|-----------|------|----------|-------------|');

  for (const [name, field] of Object.entries(shape) as [string, any][]) {
    const required = !field.isOptional?.();
    const type = extractType(field);
    const desc = (field.description || '').replace(/\|/g, '\\|');
    rows.push(`| ${name} | ${type} | ${required ? 'Yes' : 'No'} | ${desc} |`);
  }

  return rows.join('\n') + '\n';
}

/**
 * Generate the complete tool guide markdown from the registry.
 */
export function generateToolGuide(registry: ToolRegistry): string {
  const tools = registry.getPublic();
  const sources = registry.getToolSources();

  const sections: string[] = [];

  sections.push('# Strapi AI Tools Guide\n');
  sections.push('## Getting Started\n');
  sections.push(
    'Start with `list_content_types` to discover your content types and their fields, ' +
    'then use `search_content` to query them.\n'
  );

  // Group tools by source. Plugin sources may have declared metadata via
  // `getMeta()` (collected in bootstrap.ts); when present, it replaces the
  // raw source id as the heading and supplies a description/keywords blurb —
  // this is where the retired server's `instructions` content now lives.
  for (const source of sources) {
    const meta = source.id === 'built-in' ? undefined : registry.getSourceMeta(source.id);
    const heading = source.id === 'built-in' ? 'Built-in Tools' : (meta?.label ?? source.label);
    sections.push(`## ${heading}\n`);

    if (meta?.description) {
      sections.push(`${meta.description}\n`);
    }
    if (meta?.keywords && meta.keywords.length > 0) {
      sections.push(`_Keywords: ${meta.keywords.join(', ')}_\n`);
    }

    for (const toolName of source.tools) {
      const def = tools.get(toolName);
      if (!def) continue; // skip internal tools not in public set

      const mcpName = toSnakeCase(toolName);
      sections.push(`### ${mcpName}\n`);
      sections.push(`${def.description}\n`);
      sections.push(formatParams(def.schema));
    }
  }

  // Common workflows
  sections.push('## Common Workflows\n');

  sections.push('### Create a blog post\n');
  sections.push(
    '1. Call `list_content_types` to discover the article/blog content type and its fields\n' +
    '2. (Optional) Call `upload_media` with a URL to upload a cover image\n' +
    '3. Call `create_content` with the content type UID and field data\n'
  );

  sections.push('### Find and update content\n');
  sections.push(
    '1. Call `search_content` with filters or a query to find the document\n' +
    '2. Note the `documentId` from the results\n' +
    '3. Call `update_content` with the content type, documentId, and fields to change\n'
  );

  sections.push('### Content analytics\n');
  sections.push(
    '1. Call `aggregate_content` with operation `count` for totals\n' +
    '2. Use `countByField` with `groupByField` to see distribution (e.g. articles per category)\n' +
    '3. Use `countByDateRange` with `granularity` to see trends over time\n'
  );

  return sections.join('\n');
}
