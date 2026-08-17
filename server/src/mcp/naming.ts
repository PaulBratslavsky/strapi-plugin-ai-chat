/**
 * Registry names are camelCase and may carry a `<source>__` namespace prefix
 * added during plugin tool discovery. MCP clients expect snake_case, matching
 * the convention of Strapi's own built-in tools (list_article, get_article).
 */

/** Convert a registry name to its MCP name. */
export function toSnakeCase(str: string): string {
  return str
    .replace(/:/g, '__')
    .replace(/-/g, '_')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Resolve which plugin contributed a tool, or 'built-in'. */
export function getToolSource(name: string): string {
  const sep = name.indexOf('__');
  return sep === -1 ? 'built-in' : name.substring(0, sep);
}

/** Human-readable title, e.g. "Strapi: Search Content". */
export function toTitle(name: string): string {
  const mcpName = toSnakeCase(name);
  const source = getToolSource(name);
  const prefix = source === 'built-in' ? 'Strapi' : source.replace(/_/g, '-');
  const shortName = mcpName
    .replace(/^[a-z_]+__/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${prefix}: ${shortName}`;
}
