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

/**
 * MCP name with the source-namespace prefix (`<source>__`) stripped, e.g.
 * "ai_sdk_yt_transcripts__fetch_transcript" -> "fetch_transcript". Used for
 * the admin action uid: the plugin section (derived separately from
 * `getToolSource`) already disambiguates the source, so repeating it in the
 * uid tail would be redundant.
 */
export function toBareMcpName(name: string): string {
  return toSnakeCase(name).replace(/^[a-z_]+__/, '');
}

/**
 * Short, sentence-case display name for the admin permissions grid, e.g.
 * "Search content" or "Fetch transcript". Strips the source-namespace
 * prefix since the grid already clusters tools by plugin section —
 * repeating the source in every checkbox label would be redundant.
 */
export function toDisplayName(name: string): string {
  const shortName = toBareMcpName(name).replace(/_/g, ' ');
  return shortName.charAt(0).toUpperCase() + shortName.slice(1);
}

/**
 * Slug for the admin permission action uid, e.g. "search-content" or
 * "fetch-transcript". Strapi's admin action uid validator only accepts
 * lowercase letters, dots, and hyphens (`/^[a-z]([a-z|.|-]+)[a-z]$/`) — no
 * underscores — so this is `toBareMcpName` with underscores swapped for
 * hyphens, distinct from the MCP tool name itself (which stays snake_case).
 */
export function toActionSlug(name: string): string {
  return toBareMcpName(name).replace(/_/g, '-');
}
