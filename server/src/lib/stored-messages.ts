import { z } from 'zod';

/**
 * The contract for what lives in a conversation's `messages` field.
 *
 * That field is `"type": "json"` — Strapi stores whatever it is handed and
 * validates nothing. Before this module the shape was implicit: whatever the
 * admin panel's `Message` interface happened to be when the row was written.
 * Different plugin versions could write different shapes with no way to tell
 * them apart, and a malformed client could silently corrupt history.
 *
 * Storage now speaks the AI SDK's `UIMessage`: an ordered `parts[]` array.
 * Two reasons.
 *
 * The old shape lost information. `{ content: string, toolCalls: [] }` keeps
 * all text in one string with tool calls in a list beside it, so a turn that
 * ran "let me search…" → tool → "here's what I found" could not be
 * reconstructed. `parts[]` is ordered, so it can.
 *
 * And it is what the rest of the stack already speaks. The server streams
 * `toUIMessageStreamResponse()`; storing the same representation removes the
 * translation layer where lossy bugs live, and makes every future part type —
 * reasoning, citations, attachments — a rendering concern rather than a
 * storage migration.
 */

export const STORAGE_VERSION = 2;

/** A text segment of an assistant or user turn. */
const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

/**
 * A tool invocation. The SDK types these as `tool-<toolName>`, so the literal
 * type string is open-ended and validated by prefix rather than enumeration —
 * a new tool must not require a schema change here.
 */
const toolPartSchema = z
  .object({
    type: z.string().startsWith('tool-'),
    toolCallId: z.string(),
    toolName: z.string().optional(),
    state: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    errorText: z.string().optional(),
  })
  .passthrough();

/**
 * Anything else the SDK emits — `reasoning`, `source-url`, `file`, and
 * whatever comes next. Preserved verbatim rather than rejected: a part this
 * version does not understand is still worth keeping, since dropping it would
 * silently damage the conversation for a future version that does.
 */
const unknownPartSchema = z
  .object({ type: z.string() })
  .passthrough();

const partSchema = z.union([textPartSchema, toolPartSchema, unknownPartSchema]);

export const uiMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(partSchema),
});

export type StoredUIMessage = z.infer<typeof uiMessageSchema>;

/** The versioned envelope written to the `messages` field. */
export const storedMessagesSchema = z.object({
  v: z.literal(STORAGE_VERSION),
  messages: z.array(uiMessageSchema),
});

export type StoredMessages = z.infer<typeof storedMessagesSchema>;

// --- legacy (v1) ------------------------------------------------------------

/**
 * The pre-2.1 shape: a bare array, no envelope. Kept only to read rows written
 * before this module existed.
 */
const legacyToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

const legacyMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant']),
  content: z.string().optional(),
  toolCalls: z.array(legacyToolCallSchema).optional(),
});

function legacyId(index: number): string {
  return `legacy-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Convert one v1 message to a `UIMessage`.
 *
 * Text comes first, then tool calls. That ordering is a reconstruction, not a
 * recovery: v1 never recorded where a tool call sat relative to the text, so
 * there is nothing to be faithful to. Putting text first matches how these
 * conversations already rendered, so nothing appears to move.
 */
function migrateLegacyMessage(message: z.infer<typeof legacyMessageSchema>, index: number): StoredUIMessage {
  const parts: StoredUIMessage['parts'] = [];

  if (message.content) {
    parts.push({ type: 'text', text: message.content });
  }

  for (const call of message.toolCalls ?? []) {
    parts.push({
      type: `tool-${call.toolName}`,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      state: call.output !== undefined ? 'output-available' : 'input-available',
      ...(call.input !== undefined ? { input: call.input } : {}),
      ...(call.output !== undefined ? { output: call.output } : {}),
    });
  }

  return { id: message.id ?? legacyId(index), role: message.role, parts };
}

// --- read / write -----------------------------------------------------------

/**
 * Read whatever is in the database and return current-version messages.
 *
 * Deliberately total: a conversation that cannot be parsed returns empty
 * rather than throwing. A corrupt row should cost the user that conversation's
 * history, not the ability to open the page — and the caller logs it, so it is
 * visible rather than swallowed.
 */
export function readStoredMessages(
  raw: unknown,
): { messages: StoredUIMessage[]; migrated: boolean; error?: string } {
  if (raw === null || raw === undefined) {
    return { messages: [], migrated: false };
  }

  const current = storedMessagesSchema.safeParse(raw);
  if (current.success) {
    return { messages: current.data.messages, migrated: false };
  }

  const legacy = z.array(legacyMessageSchema).safeParse(raw);
  if (legacy.success) {
    return { messages: legacy.data.map(migrateLegacyMessage), migrated: true };
  }

  return {
    messages: [],
    migrated: false,
    error: `unrecognised shape: ${current.error.issues[0]?.message ?? 'unknown'}`,
  };
}

/**
 * Validate an incoming payload and wrap it for storage.
 *
 * Accepts the legacy shape too, so an admin panel from an older build keeps
 * working during a rolling upgrade — it is normalised to the current version
 * on the way in, which is also what makes rows heal by being touched.
 */
/**
 * Not a discriminated union. Strapi's server tsconfig sets `strict: false`,
 * which disables `strictNullChecks`, and without it TypeScript will not narrow
 * `{ok: true, ...} | {ok: false, ...}` on an `if (!result.ok)` check — every
 * call site would report the other branch's fields as missing. Optional fields
 * on one interface behave correctly under these compiler settings.
 */
export interface ToStoredResult {
  ok: boolean;
  value?: StoredMessages;
  error?: string;
}

export function toStoredMessages(input: unknown): ToStoredResult {
  const envelope = storedMessagesSchema.safeParse(input);
  if (envelope.success) {
    return { ok: true, value: envelope.data };
  }

  const bare = z.array(uiMessageSchema).safeParse(input);
  if (bare.success) {
    return { ok: true, value: { v: STORAGE_VERSION, messages: bare.data } };
  }

  const legacy = z.array(legacyMessageSchema).safeParse(input);
  if (legacy.success) {
    return { ok: true, value: { v: STORAGE_VERSION, messages: legacy.data.map(migrateLegacyMessage) } };
  }

  const issue = bare.error.issues[0];
  return {
    ok: false,
    error: issue ? `${issue.path.join('.') || 'messages'}: ${issue.message}` : 'invalid messages payload',
  };
}
