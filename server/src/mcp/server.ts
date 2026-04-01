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
// Zod → JSON Schema conversion (supports both Zod 3 and Zod 4)
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
 * Get the Zod type identifier, supporting both Zod 3 (typeName) and Zod 4 (type).
 */
function getZodType(field: any): string | undefined {
  const def = field?._def;
  if (!def) return undefined;
  // Zod 3 uses _def.typeName (e.g. "ZodString"), Zod 4 uses _def.type (e.g. "string")
  return def.typeName ?? def.type;
}

/**
 * Get the description from a Zod field.
 * Zod 3: _def.description; Zod 4: field.description
 */
function getDescription(field: any): string | undefined {
  return field?.description ?? field?._def?.description;
}

/**
 * Convert a Zod schema to a JSON Schema object with additionalProperties: false.
 *
 * Handles both Zod 3 and Zod 4 field definitions to ensure all tools
 * produce complete JSON Schema with proper types, descriptions, and
 * additionalProperties: false for mcp-remote/Claude Desktop compatibility.
 */
function zodToInputSchema(schema: ToolDefinition['schema']): JsonSchema {
  const shape = schema.shape;
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [key, fieldDef] of Object.entries(shape)) {
    const prop = zodFieldToJsonSchema(fieldDef as any);
    properties[key] = prop;

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
  const t = getZodType(field);
  if (!t) return false;
  const normalized = normalizeType(t);
  if (normalized === 'optional' || normalized === 'default') return true;
  // Walk through wrapping types
  if (field._def?.innerType) return isOptionalOrDefaulted(field._def.innerType);
  return false;
}

/** Normalize Zod 3 "ZodString" → "string" and Zod 4 "string" → "string" */
function normalizeType(t: string): string {
  // Zod 3: "ZodString" → "string", "ZodOptional" → "optional", etc.
  if (t.startsWith('Zod')) return t.slice(3).toLowerCase();
  return t.toLowerCase();
}

/** Convert a single Zod field to a JSON Schema property */
function zodFieldToJsonSchema(field: any): JsonSchemaProperty {
  const rawType = getZodType(field);
  if (!rawType) return {};

  const t = normalizeType(rawType);
  const def = field._def;
  const prop: JsonSchemaProperty = {};

  const desc = getDescription(field);
  if (desc) prop.description = desc;

  switch (t) {
    case 'string':
      prop.type = 'string';
      break;

    case 'number': {
      prop.type = 'number';
      // Zod 4: field.isInt, field.minValue, field.maxValue
      if (field.isInt) prop.type = 'integer';
      if (typeof field.minValue === 'number' && field.minValue > -Number.MAX_SAFE_INTEGER) prop.minimum = field.minValue;
      if (typeof field.maxValue === 'number' && field.maxValue < Number.MAX_SAFE_INTEGER) prop.maximum = field.maxValue;
      // Zod 3: _def.checks array
      if (def.checks && Array.isArray(def.checks)) {
        for (const check of def.checks) {
          if (check.kind === 'min') prop.minimum = check.value;
          if (check.kind === 'max') prop.maximum = check.value;
          if (check.kind === 'int') prop.type = 'integer';
        }
      }
      break;
    }

    case 'boolean':
      prop.type = 'boolean';
      break;

    case 'enum': {
      prop.type = 'string';
      // Zod 3: _def.values (array); Zod 4: _def.entries (object) or field.options (array)
      if (Array.isArray(def.values)) {
        prop.enum = def.values;
      } else if (def.entries) {
        prop.enum = Object.keys(def.entries);
      } else if (Array.isArray(field.options)) {
        prop.enum = field.options;
      }
      break;
    }

    case 'array': {
      prop.type = 'array';
      // Zod 3: _def.type; Zod 4: _def.element
      const itemType = def.element ?? def.type;
      if (itemType) {
        const itemSchema = zodFieldToJsonSchema(itemType);
        prop.items = Object.keys(itemSchema).length > 0 ? itemSchema : { type: 'string' };
      }
      break;
    }

    case 'object': {
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
    }

    case 'optional': {
      const inner = zodFieldToJsonSchema(def.innerType);
      if (desc) inner.description = desc;
      return inner;
    }

    case 'default': {
      const inner = zodFieldToJsonSchema(def.innerType);
      // Zod 3: defaultValue is a function; Zod 4: defaultValue is the raw value
      const dv = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
      if (dv !== undefined) inner.default = dv;
      if (desc) inner.description = desc;
      return inner;
    }

    case 'effects':
      // .transform(), .refine(), .pipe() — unwrap
      return zodFieldToJsonSchema(def.schema ?? def.innerType);

    case 'nullable':
      return zodFieldToJsonSchema(def.innerType);

    case 'union': {
      // Zod 3: _def.options; Zod 4: _def.options
      const options = def.options;
      if (Array.isArray(options) && options.length > 0) {
        return zodFieldToJsonSchema(options[0]);
      }
      break;
    }

    case 'record':
      prop.type = 'object';
      break;

    case 'literal':
      // Extract the literal value
      if (def.value !== undefined) {
        prop.type = typeof def.value;
        prop.enum = [def.value];
      }
      break;

    case 'any':
    case 'unknown':
      break;
  }

  return prop;
}

// ---------------------------------------------------------------------------
// MCP argument coercion
// ---------------------------------------------------------------------------

/**
 * Pre-process MCP arguments before Zod validation.
 *
 * MCP clients (especially via mcp-remote) may send JSON-encoded strings
 * for complex types — e.g. fields: '["title","slug"]' instead of an actual
 * array. This function detects such cases by inspecting the Zod schema's
 * expected type and parsing stringified JSON values into their proper types.
 *
 * This is the MCP boundary layer — tool logic should never need to worry
 * about string-vs-parsed arguments.
 */
function coerceArgs(args: Record<string, unknown>, schema: ToolDefinition['schema']): Record<string, unknown> {
  const shape = schema.shape;
  const result = { ...args };

  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== 'string') continue;

    const fieldDef = (shape as Record<string, any>)[key];
    if (!fieldDef) continue;

    const expectedType = resolveBaseType(fieldDef);

    // If the schema expects an object or array but got a string, try JSON.parse
    if (expectedType === 'object' || expectedType === 'array') {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null) {
          result[key] = parsed;
        }
      } catch {
        // Not valid JSON — leave as-is, Zod will handle the error
      }
    }
  }

  return result;
}

/** Walk through optional/default wrappers to find the base Zod type */
function resolveBaseType(field: any): string | undefined {
  const rawType = getZodType(field);
  if (!rawType) return undefined;
  const t = normalizeType(rawType);

  if ((t === 'optional' || t === 'default' || t === 'nullable') && field._def?.innerType) {
    return resolveBaseType(field._def.innerType);
  }

  if (t === 'record') return 'object';
  return t;
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
      // Coerce MCP args through the Zod schema before executing.
      // MCP clients may send JSON strings for objects/arrays (e.g. fields: "[\"title\"]"
      // instead of fields: ["title"]). Pre-parse stringified JSON values, then let
      // Zod validate and coerce the rest (defaults, type casting, etc.).
      const coerced = coerceArgs(args ?? {}, def.schema);
      const validated = def.schema.parse(coerced);
      const result = await def.execute(validated, strapi);
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
