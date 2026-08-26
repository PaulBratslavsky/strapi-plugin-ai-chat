import type { Core } from '@strapi/strapi';
import type { z } from 'zod';
import type { AccessTier } from '../mcp/access';

/**
 * Minimal shape of the CASL ability Strapi puts on `ctx.state.userAbility`.
 * Both the admin session strategy and the admin-token strategy set it, so the
 * same check covers a logged-in admin (RBAC role grants) and an admin API
 * token (token grants).
 */
export interface CallerAbility {
  can: (action: string) => boolean;
}

export interface ToolContext {
  adminUserId?: number;
  enabledToolSources?: string[];
  /**
   * Caller's ability. When present, tools the caller lacks permission for are
   * withheld from the model. Omitted for non-HTTP callers, which are trusted.
   */
  ability?: CallerAbility;
  /**
   * Aborted when the turn is cancelled or the tool exceeds its timeout.
   *
   * Honouring it is optional and worth doing for anything that makes a network
   * call: pass it to `fetch`, and a stopped chat stops the request instead of
   * leaving it to finish into nothing. A tool that ignores it still gets
   * abandoned on timeout — it just keeps running in the background.
   */
  abortSignal?: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  execute: (args: any, strapi: Core.Strapi, context?: ToolContext) => Promise<unknown>;
  /** If true, tool is only available in AI SDK chat, not exposed via MCP */
  internal?: boolean;
  /**
   * Marks a tool as read-only and low-risk.
   *
   * This no longer grants anything. It used to decide what anonymous public
   * chat could reach, which failed open — a tool author forgetting the flag
   * was the only thing between a visitor and a write tool. Public chat now
   * lives in `strapi-plugin-ai-sdk-public-chat`, which takes an explicit
   * allow-list and defaults to exposing nothing.
   *
   * What remains is risk metadata: `tierFor()` reads it to label a tool
   * 'read' vs 'write' in the permissions grid, to help a human decide what to
   * tick. It is a hint, not a boundary.
   */
  publicSafe?: boolean;
  /**
   * MCP permission tier. Defaults to 'read' when publicSafe is true,
   * otherwise 'write'. Set explicitly for tools whose risk does not match
   * that default — e.g. irreversible or external-side-effect tools.
   */
  access?: AccessTier;
  /**
   * This tool may be called repeatedly within one turn.
   *
   * A mutating tool is normally withdrawn once it returns a result, so a model
   * cannot redo a write it has already completed. That protects tools where a
   * second call would duplicate the first — `createContent` writing the same
   * article twice.
   *
   * It is wrong for tools where each call is a separate item. `uploadMedia`
   * called three times uploads three files; withdrawing it after the first
   * leaves the model unable to finish, usually reporting success for images it
   * never uploaded.
   *
   * Set this only when repeating the call with different arguments is the
   * normal way to use the tool. It does not affect permissions: the tool is
   * still gated by its own action and still tiered by `access`.
   */
  repeatable?: boolean;
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

}
