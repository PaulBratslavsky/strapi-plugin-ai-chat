import type { Core } from '@strapi/strapi';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { PluginInstance } from '../lib/types';
import type { ToolDefinition, ToolRegistry } from '../lib/tool-registry';
import { generateToolGuide } from './resources/tool-guide';

/** Convert camelCase to snake_case for MCP tool names, handling namespaced names (colons and hyphens) */
function toSnakeCase(str: string): string {
  return str
    .replace(/:/g, '__')
    .replace(/-/g, '_')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Convert snake_case MCP name to a human-readable title with source prefix */
function toTitle(mcpName: string, source: string): string {
  const prefix = source === 'built-in' ? 'Strapi' : source.replace(/_/g, '-');
  const shortName = mcpName
    .replace(/^[a-z_]+__/, '') // strip namespace prefix
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${prefix}: ${shortName}`;
}

/** Resolve the source group for a tool name */
function getToolSource(name: string): string {
  const sep = name.indexOf('__');
  return sep === -1 ? 'built-in' : name.substring(0, sep);
}

/**
 * Summarize a source's capabilities from its tool descriptions.
 * Extracts the first sentence of each tool description.
 */
function summarizeTools(tools: string[], registry: ToolRegistry): string {
  const summaries: string[] = [];
  for (const name of tools) {
    const def = registry.get(name);
    if (!def) continue;
    const first = def.description.split(/\.\s/)[0].replace(/\.$/, '');
    summaries.push(first);
  }
  return summaries.join('. ') + '.';
}

/**
 * Build server instructions dynamically from the registry so MCP clients
 * (Claude Desktop, Claude Code, Cursor, etc.) know when to load tools.
 *
 * The instructions string is the PRIMARY signal Claude Desktop uses with
 * "Load tools when needed" to decide whether to activate this server.
 *
 * Plugins that provide getMeta() on their ai-tools service get rich
 * keyword-driven entries. Others get auto-generated summaries from
 * their tool descriptions.
 */
function buildInstructions(registry: ToolRegistry): string {
  const sources = registry.getToolSources();
  const lines: string[] = [];

  lines.push(
    'Strapi CMS MCP server. Use this server for ANY of the following:'
  );

  // Built-in tools always get a static entry
  lines.push(
    '- /strapi — Query, create, update, delete CMS content (articles, pages, authors, categories, media, any custom content types)',
  );

  // Dynamic entries from plugin sources
  for (const source of sources) {
    if (source.id === 'built-in') continue;

    const meta = registry.getSourceMeta(source.id);
    if (meta) {
      const prefix = meta.keywords?.length
        ? meta.keywords.map((k) => (k.startsWith('/') ? k : `/${k}`)).join(' or ')
        : `/${source.id.replace(/_/g, '-')}`;
      lines.push(`- ${prefix} — ${meta.description}`);
    } else {
      const label = source.id.replace(/_/g, '-');
      const summary = summarizeTools(source.tools, registry);
      lines.push(`- /${label} — ${summary}`);
    }
  }

  // Always include built-in capability hints
  lines.push(
    '- /memory — Save and recall user facts and preferences',
    '- /notes — Save and recall research notes, code snippets, ideas',
    '- /tasks — Create, update, complete, and list tasks',
    '- /email — Send emails',
    '- /media — Upload media files to the CMS',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Zod → JSON Schema conversion
// ---------------------------------------------------------------------------

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  enum?: unknown[];
  items?: Record<string, unknown>;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}

/**
 * Convert a Zod schema to a JSON Schema object with additionalProperties: false.
 *
 * This replaces the McpServer's internal Zod→JSON Schema conversion which
 * varies between Zod 3 and Zod 4, causing tools to be silently dropped
 * by mcp-remote when additionalProperties is missing.
 */
function zodToInputSchema(schema: ToolDefinition['schema']): JsonSchema {
  const shape = schema.shape;
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [key, fieldDef] of Object.entries(shape)) {
    const prop = zodFieldToJsonSchema(fieldDef as any);
    properties[key] = prop;

    // Check if the field is required (not optional, not defaulted)
    if (!isOptionalOrDefaulted(fieldDef as any)) {
      required.push(key);
    }
  }

  const result: JsonSchema = {
    type: 'object',
    properties,
    additionalProperties: false,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}

/** Check if a Zod field is optional or has a default */
function isOptionalOrDefaulted(field: any): boolean {
  if (!field) return true;

  // Zod 3 and 4 both expose _def
  const def = field._def;
  if (!def) return false;

  const typeName = def.typeName;
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') return true;

  // Walk through wrapping types
  if (def.innerType) return isOptionalOrDefaulted(def.innerType);
  return false;
}

/** Convert a single Zod field to a JSON Schema property */
function zodFieldToJsonSchema(field: any): JsonSchemaProperty {
  if (!field?._def) return {};

  const def = field._def;
  const typeName = def.typeName;
  const prop: JsonSchemaProperty = {};

  // Extract description from any level
  if (def.description) prop.description = def.description;

  switch (typeName) {
    case 'ZodString':
      prop.type = 'string';
      break;
    case 'ZodNumber':
      prop.type = 'number';
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') prop.minimum = check.value;
          if (check.kind === 'max') prop.maximum = check.value;
          if (check.kind === 'int') prop.type = 'integer';
        }
      }
      break;
    case 'ZodBoolean':
      prop.type = 'boolean';
      break;
    case 'ZodEnum':
      prop.type = 'string';
      prop.enum = def.values;
      break;
    case 'ZodArray':
      prop.type = 'array';
      if (def.type) {
        prop.items = zodFieldToJsonSchema(def.type);
      }
      break;
    case 'ZodObject':
      prop.type = 'object';
      if (field.shape) {
        const nested: Record<string, JsonSchemaProperty> = {};
        for (const [k, v] of Object.entries(field.shape)) {
          nested[k] = zodFieldToJsonSchema(v as any);
        }
        prop.properties = nested;
        prop.additionalProperties = false;
      }
      break;
    case 'ZodOptional':
      return { ...zodFieldToJsonSchema(def.innerType), ...(def.description ? { description: def.description } : {}) };
    case 'ZodDefault':
      return {
        ...zodFieldToJsonSchema(def.innerType),
        default: def.defaultValue(),
        ...(def.description ? { description: def.description } : {}),
      };
    case 'ZodEffects':
      // .transform(), .refine(), .pipe() — unwrap
      return zodFieldToJsonSchema(def.schema);
    case 'ZodNullable':
      return zodFieldToJsonSchema(def.innerType);
    case 'ZodUnion':
      // Simple union — just use the first option for schema hint
      if (def.options?.length) {
        return zodFieldToJsonSchema(def.options[0]);
      }
      break;
    case 'ZodRecord':
      prop.type = 'object';
      break;
    case 'ZodAny':
      // No type constraint
      break;
  }

  return prop;
}

// ---------------------------------------------------------------------------
// MCP Server Factory
// ---------------------------------------------------------------------------

/**
 * Create an MCP server instance configured with public tools from the registry.
 * Internal tools are excluded.
 *
 * Uses the low-level Server class (not McpServer) for full control over
 * the JSON Schema output, ensuring compatibility with mcp-remote and
 * Claude Desktop regardless of Zod version.
 */
export function createMcpServer(strapi: Core.Strapi): Server {
  const plugin = strapi.plugin('ai-sdk') as unknown as PluginInstance;
  const registry = plugin.toolRegistry;

  if (!registry) {
    throw new Error('Tool registry not initialized');
  }

  const instructions = buildInstructions(registry);

  const server = new Server(
    {
      name: 'strapi-ai-sdk',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions,
    }
  );

  // Build the tool list and handler map
  const toolList: Array<{
    name: string;
    title: string;
    description: string;
    inputSchema: JsonSchema;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  }> = [];
  const toolHandlers = new Map<string, ToolDefinition>();

  for (const [name, def] of registry.getPublic()) {
    const mcpName = toSnakeCase(name);
    const source = getToolSource(name);

    toolList.push({
      name: mcpName,
      title: toTitle(mcpName, source),
      description: def.description,
      inputSchema: zodToInputSchema(def.schema),
      annotations: {
        readOnlyHint: def.publicSafe ?? false,
        destructiveHint: false,
      },
    });

    toolHandlers.set(mcpName, def);
  }

  // Register tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    strapi.log.debug('[ai-sdk:mcp] Listing tools');
    return { tools: toolList };
  });

  // Register tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    strapi.log.debug(`[ai-sdk:mcp] Tool call: ${name}`);

    const def = toolHandlers.get(name);
    if (!def) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    try {
      const result = await def.execute(args ?? {}, strapi);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      strapi.log.error(`[ai-sdk:mcp] Tool ${name} failed:`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: String(error) }) }],
        isError: true,
      };
    }
  });

  // Register the tool guide as a static resource
  const guideMarkdown = generateToolGuide(registry);

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'strapi://tools/guide',
        name: 'Tool Guide',
        description: 'Complete guide to all available Strapi AI tools with parameters and usage examples',
        mimeType: 'text/markdown',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === 'strapi://tools/guide') {
      return {
        contents: [
          {
            uri: 'strapi://tools/guide',
            mimeType: 'text/markdown',
            text: guideMarkdown,
          },
        ],
      };
    }
    throw new Error(`Resource not found: ${request.params.uri}`);
  });

  const toolNames = toolList.map((t) => t.name);
  strapi.log.info('[ai-sdk:mcp] MCP server created with tools:', { tools: toolNames });
  strapi.log.debug('[ai-sdk:mcp] Server instructions:', instructions);

  return server;
}
