import type { Core } from '@strapi/strapi';
import type { z } from 'zod';
import type { AccessTier } from '../mcp/access';

export interface ToolContext {
  adminUserId?: number;
  enabledToolSources?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  execute: (args: any, strapi: Core.Strapi, context?: ToolContext) => Promise<unknown>;
  /** If true, tool is only available in AI SDK chat, not exposed via MCP */
  internal?: boolean;
  /** If true, tool is safe for unauthenticated public chat (read-only) */
  publicSafe?: boolean;
  /**
   * MCP permission tier. Defaults to 'read' when publicSafe is true,
   * otherwise 'write'. Set explicitly for tools whose risk does not match
   * that default — e.g. irreversible or external-side-effect tools.
   */
  access?: AccessTier;
}

/** Type alias for external plugin authors to import when contributing tools */
export type AiToolContribution = ToolDefinition;

/** Metadata a plugin can optionally provide to describe its tool source */
export interface ToolSourceMeta {
  /** Short human-readable label, e.g. "YouTube Transcripts" */
  label: string;
  /** One-line capability summary for MCP instructions */
  description: string;
  /** Trigger keywords/prefixes users might type, e.g. ["/youtube", "/yt", "transcript"] */
  keywords?: string[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly sourceMeta = new Map<string, ToolSourceMeta>();

  /** Register metadata for a tool source (plugin namespace) */
  setSourceMeta(sourceId: string, meta: ToolSourceMeta): void {
    this.sourceMeta.set(sourceId, meta);
  }

  /** Get metadata for a tool source, if provided */
  getSourceMeta(sourceId: string): ToolSourceMeta | undefined {
    return this.sourceMeta.get(sourceId);
  }

  register(def: ToolDefinition): void {
    this.tools.set(def.name, def);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** All registered tools (internal + public) */
  getAll(): Map<string, ToolDefinition> {
    return new Map(this.tools);
  }

  /** Only tools that should be exposed via MCP (non-internal) */
  getPublic(): Map<string, ToolDefinition> {
    const result = new Map<string, ToolDefinition>();
    for (const [name, def] of this.tools) {
      if (!def.internal) {
        result.set(name, def);
      }
    }
    return result;
  }

  /** Returns metadata about tool sources grouped by plugin prefix */
  getToolSources(): Array<{ id: string; label: string; toolCount: number; tools: string[] }> {
    const groups = new Map<string, string[]>();

    for (const name of this.tools.keys()) {
      const sepIndex = name.indexOf('__');
      if (sepIndex === -1) {
        // Built-in tool
        const list = groups.get('built-in') ?? [];
        list.push(name);
        groups.set('built-in', list);
      } else {
        const prefix = name.substring(0, sepIndex);
        const list = groups.get(prefix) ?? [];
        list.push(name);
        groups.set(prefix, list);
      }
    }

    return Array.from(groups.entries()).map(([id, tools]) => ({
      id,
      label: id === 'built-in' ? 'Built-in Tools' : id,
      toolCount: tools.length,
      tools,
    }));
  }

  /** Only tools marked safe for unauthenticated public chat */
  getPublicSafe(): Map<string, ToolDefinition> {
    const result = new Map<string, ToolDefinition>();
    for (const [name, def] of this.tools) {
      if (def.publicSafe) {
        result.set(name, def);
      }
    }
    return result;
  }
}
