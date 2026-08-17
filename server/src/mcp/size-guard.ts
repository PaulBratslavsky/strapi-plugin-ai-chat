/**
 * MCP clients reject a tool result over ~1 MB with an opaque
 * "Tool result is too large" error the agent cannot act on. We guard just
 * under that so the agent instead receives a structured, actionable message
 * and can re-issue the call with pagination.
 *
 * CRUCIAL: the result rides the wire TWICE — once as JSON text in `content`
 * and once as `structuredContent` — so the payload is roughly 2x the
 * serialized result. Measure the doubled size, not one copy.
 */
export const MAX_WIRE_BYTES = 950_000;

/** Per-tool hints for making an oversized result smaller. */
function shrinkHint(toolName: string): string {
  switch (toolName) {
    case 'searchContent':
      return 'Re-issue with a smaller pageSize, narrow `fields`, or leave includeContent false.';
    case 'aggregateContent':
      return 'Narrow the date range or group by a lower-cardinality field.';
    case 'findOneContent':
      return 'Request specific `fields` instead of the whole document, or reduce `populate`.';
    default:
      return 'Re-issue with pagination / a smaller page size, or request fewer fields.';
  }
}

/**
 * Return `result` unchanged when it fits, or a structured notice when it
 * would blow the client's limit.
 */
export function guardSize(result: unknown, toolName: string): unknown {
  const serialized = JSON.stringify(result);
  if (serialized === undefined) return result;

  const bytes = Buffer.byteLength(serialized, 'utf8');
  const wireBytes = bytes * 2 + 2048;
  if (wireBytes <= MAX_WIRE_BYTES) return result;

  return {
    error: 'RESULT_TOO_LARGE',
    tool: toolName,
    bytes: wireBytes,
    limitBytes: MAX_WIRE_BYTES,
    message: `This ${toolName} result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire (sent twice), over the ~1 MB MCP response limit. ${shrinkHint(toolName)}`,
  };
}
