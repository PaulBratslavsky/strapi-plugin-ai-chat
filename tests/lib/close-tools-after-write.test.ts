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

/** A write where each call is a distinct item, e.g. one file per call. */
const repeatableWriteTool = {
  name: 'uploadMedia',
  description: 'Upload',
  schema: z.object({}),
  execute: async () => ({}),
  repeatable: true,
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

  describe('repeatable writes', () => {
    // These need a non-repeatable write in the registry too, otherwise there
    // is nothing to withdraw and no hook is produced at all — the case the
    // last test in this block covers.
    it('keeps a repeatable write available after it succeeds', () => {
      const { prepare } = setup(readTool, writeTool, repeatableWriteTool);

      // Uploading a second image is a second upload, not a repeat of the first.
      expect(prepare!({ steps: [step('uploadMedia')] })).toEqual({});
    });

    it('stays available across many successful calls', () => {
      const { prepare } = setup(readTool, writeTool, repeatableWriteTool);

      const steps = [step('uploadMedia'), step('uploadMedia'), step('uploadMedia')];

      expect(prepare!({ steps })).toEqual({});
    });

    it('still withdraws non-repeatable writes in the same turn', () => {
      const { prepare } = setup(readTool, writeTool, repeatableWriteTool);

      const result = prepare!({ steps: [step('uploadMedia'), step('createContent')] });

      // uploadMedia survives so the gallery can continue; createContent does not.
      expect(result.activeTools).toEqual(['searchContent', 'uploadMedia']);
    });

    it('gives the SDK no hook when every mutating tool is repeatable', () => {
      const { prepare } = setup(readTool, repeatableWriteTool);

      expect(prepare).toBeUndefined();
    });
  });
});
