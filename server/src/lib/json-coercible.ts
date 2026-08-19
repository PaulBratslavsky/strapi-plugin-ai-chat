import { z } from 'zod';

/**
 * Wrap a schema so a JSON-encoded string is parsed before validation.
 *
 * MCP clients — notably via mcp-remote — sometimes send complex arguments as
 * JSON text: `fields: '["title","slug"]'` instead of `fields: ["title"]`. The
 * official server validates arguments before our handler runs, so this must
 * live in the schema itself.
 *
 * `z.preprocess` is deliberate: it coerces at parse time while still emitting
 * the wrapped schema's own JSON Schema, so clients keep seeing a typed
 * parameter. A union would emit `anyOf` and would not coerce.
 *
 * Only strings that look like JSON objects or arrays are touched, so genuine
 * string values (e.g. populate: "*") pass through untouched.
 */
export function jsonCoercible<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Leave it as-is; the wrapped schema produces the validation error.
      return value;
    }
  }, schema) as z.ZodType<z.infer<T>>;
}
