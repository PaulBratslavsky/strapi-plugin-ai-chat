import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../server/src/lib/tool-registry';
import { closeToolsAfterWrite } from '../../server/src/lib/close-tools-after-write';

const readTool = {
  name: 'searchContent',
  description: 'Search',
  schema: z.object({}),
  execute: async () => ({}),
  publicSafe: true,
};

const writeTool = {
  name: 'createContent',
  description: 'Create',
  schema: z.object({}),
  execute: async () => ({}),
};

const destructiveTool = {
  name: 'sendEmail',
  description: 'Send',
  schema: z.object({}),
  execute: async () => ({}),
  access: 'destructive' as const,
};

function setup(...defs: any[]) {
  const registry = new ToolRegistry();
  for (const d of defs) registry.register(d);
  const tools = Object.fromEntries(defs.map((d) => [d.name, { description: d.description }]));
  return { registry, tools, prepare: closeToolsAfterWrite(registry, tools as any) };
}

const step = (toolName: string, withResult = true) => ({
  toolCalls: [{ toolName }],
  ...(withResult ? { toolResults: [{ toolName }] } : {}),
});

describe('closeToolsAfterWrite', () => {
  it('offers everything before any tool has run', () => {
    const { prepare, tools } = setup(readTool, writeTool);

    expect(prepare!({ steps: [] })).toEqual({});
    expect(Object.keys(tools)).toEqual(['searchContent', 'createContent']);
  });

  it('withdraws a write tool once it has returned a result', () => {
    const { prepare } = setup(readTool, writeTool);

    const result = prepare!({ steps: [step('createContent')] });

    expect(result.activeTools).toEqual(['searchContent']);
  });

  it('keeps read tools available, since re-reading is legitimate', () => {
    const { prepare } = setup(readTool, writeTool);

    const result = prepare!({ steps: [step('createContent'), step('searchContent')] });

    expect(result.activeTools).toContain('searchContent');
  });

  it('withdraws destructive tools too', () => {
    const { prepare } = setup(readTool, destructiveTool);

    const result = prepare!({ steps: [step('sendEmail')] });

    expect(result.activeTools).toEqual(['searchContent']);
  });

  it('leaves a failed write available so the model can retry', () => {
    const { prepare } = setup(readTool, writeTool);

    // called, but produced no result: the tool threw
    const result = prepare!({ steps: [step('createContent', false)] });

    expect(result).toEqual({});
  });

  it('withdraws several write tools independently', () => {
    const { prepare } = setup(readTool, writeTool, destructiveTool);

    const result = prepare!({ steps: [step('createContent'), step('sendEmail')] });

    expect(result.activeTools).toEqual(['searchContent']);
  });

  it('returns undefined when nothing mutates, so the SDK gets no hook', () => {
    const { prepare } = setup(readTool);

    expect(prepare).toBeUndefined();
  });
});
