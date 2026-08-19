/**
 * Tier 2 live pipeline E2E test.
 *
 * Exercises the real chain: transcript fetch -> lifecycle hook -> embeddings
 * -> semantic search, all driven over MCP. Requires a running Strapi host
 * (>= 5.47) with `mcp: { enabled: true }`, an admin API token exported as
 * STRAPI_ADMIN_TOKEN, and E2E_LIVE=1 (see `npm run test:e2e:live`). Skipped
 * entirely otherwise. See tests/e2e/client.ts for the connect() helper and
 * its note on required permission tiers.
 *
 * The token needs MORE tools granted than client.ts's baseline:
 * the pre-run cleanup below (see `deleteExistingTranscript`) also calls the
 * content-manager-derived list/delete tools for the Transcript content type
 * (`plugin::ai-sdk-yt-transcripts.transcript`), which require
 * content-manager READ and DELETE permissions on that content type. Without
 * them, `findUniqueContentManagerTool` throws in `beforeAll` before any
 * pipeline assertion runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connect, toolMap } from './client';

// A short, stable, captioned video. Swap if it ever goes private.
const VIDEO_ID = 'dQw4w9WgXcQ';

const live = process.env.E2E_LIVE === '1';

let client: Client;
let tools: Record<string, any>;

/** Poll until `check` returns true or the budget runs out. */
async function waitFor(
  check: () => Promise<boolean>,
  { timeoutMs = 90_000, intervalMs = 3_000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function toolNamed(prefix: string, suffix: string): string {
  const match = Object.keys(tools).find((n) => n.startsWith(prefix) && n.endsWith(suffix));
  if (!match) throw new Error(`No tool matching ${prefix}*${suffix}. Have: ${Object.keys(tools)}`);
  return match;
}

const TRANSCRIPT_UID = 'plugin::ai-sdk-yt-transcripts.transcript';

// Content-manager derives its per-content-type tool names from this uid via
// an internal, non-exported `slugifyUidForMcpToolName` — the exact slug is
// not part of any public contract and has been observed to differ between
// installed versions of @strapi/content-manager. Rather than replicate that
// internal (and silently break when it changes), find the tool at runtime by
// substring: whatever the slugging scheme, both the uid's namespace segment
// (`ai-sdk-yt-transcripts`) and any plausible derived slug retain this
// substring, and it does not collide with this plugin's own MCP tools (those
// go through `toSnakeCase()`, which turns every hyphen into an underscore).
const TRANSCRIPT_MATCH = 'ai-sdk-yt-transcripts';

/**
 * Find exactly one tool name starting with `prefix` that identifies the
 * yt-transcripts Transcript content type. Throws if none or more than one
 * match — this cleanup step must never guess.
 */
function findUniqueContentManagerTool(prefix: string): string {
  const candidates = Object.keys(tools).filter((n) => n.startsWith(prefix));
  const matches = candidates.filter((n) => n.includes(TRANSCRIPT_MATCH));

  if (matches.length === 1) return matches[0];

  const reason = matches.length === 0 ? 'no match' : `ambiguous: ${matches.join(', ')}`;
  throw new Error(
    `Cannot guarantee a fresh run: could not uniquely identify the content-manager ` +
      `"${prefix}*" tool for the Transcript content type (${TRANSCRIPT_UID}) — ${reason}. ` +
      `This suite cannot prove the yt-embeddings lifecycle hook fires without deleting any ` +
      `pre-existing transcript for ${VIDEO_ID} first (fetchTranscript is cache-and-return-early, ` +
      `and the auto-embed hook only fires on afterCreate). Either the admin token lacks ` +
      `content-manager read + delete permissions on the Transcript content type (needed in ` +
      `in addition to the baseline tool grants — see the header comment of this ` +
      `file), the content type is no longer visible to content-manager, or its tool-naming ` +
      `scheme changed in a way this substring match no longer captures. ` +
      `Existing "${prefix}*" tools: ${candidates.join(', ') || '(none)'}. ` +
      `Refusing to proceed against unverified state.`,
  );
}

/**
 * Delete any existing transcript row(s) for VIDEO_ID via the content-manager
 * derived list/delete tools for the Transcript content type (found at
 * runtime — see findUniqueContentManagerTool).
 *
 * Why this exists (do not remove as "redundant" — see the review that added
 * it): `fetchTranscript` caches — if a transcript for this videoId already
 * exists it returns the cached row WITHOUT calling `documents(...).create()`.
 * The yt-embeddings auto-embed hook subscribes to `afterCreate` ONLY. So on
 * every run after the first, no create fires, the hook never runs, and the
 * "auto-embeds" assertion below would pass purely because a stale embedding
 * row from a previous run is still in the database — even if the hook is
 * completely broken. Deleting the transcript first forces a genuine
 * create -> afterCreate -> embed cycle every run. (The embeddings side needs
 * no separate cleanup: `embedTranscript` already deletes-and-reinserts any
 * existing `yt_videos` row for the videoId before writing, so it self-heals
 * once the create fires again.)
 *
 * This runs in beforeAll, not just afterAll — afterAll is skipped whenever a
 * test crashes mid-run, so it cannot guarantee the fresh-start precondition
 * the way beforeAll can.
 *
 * If the content-manager tools aren't available or can't be identified
 * unambiguously (e.g. the admin token lacks content-manager read/delete
 * permissions on the Transcript content type), this throws rather than
 * silently letting the suite run against stale data — a loud failure here is
 * more honest than a green run that no longer proves the hook fires.
 */
async function deleteExistingTranscript(): Promise<void> {
  const listName = findUniqueContentManagerTool('list_');
  const deleteName = findUniqueContentManagerTool('delete_');

  const listResult: any = await client.callTool({
    name: listName,
    arguments: { filters: { videoId: VIDEO_ID } },
  });

  // Fail loudly if the list tool's structuredContent shape isn't what we
  // expect, rather than silently falling back to `[]`. A silent fallback
  // here would make cleanup a no-op and turn the "auto-embeds" assertion
  // below into a false green — exactly the failure mode this cleanup step
  // exists to prevent (see the comment above).
  const structuredContent = listResult?.structuredContent;
  if (!structuredContent || typeof structuredContent !== 'object') {
    throw new Error(
      `${listName} returned no structuredContent object to clean up from. ` +
        `Full result: ${JSON.stringify(listResult)}`,
    );
  }
  if (!Array.isArray(structuredContent.results)) {
    throw new Error(
      `${listName}'s structuredContent has no "results" array — cannot verify cleanup ran. ` +
        `Keys actually present: ${Object.keys(structuredContent).join(', ') || '(none)'}. ` +
        `Update this test if the content-manager list tool's response shape changed.`,
    );
  }

  const existing: Array<{ documentId: string }> = structuredContent.results;

  for (const doc of existing) {
    await client.callTool({
      name: deleteName,
      arguments: { documentId: doc.documentId },
    });
  }
}

describe.skipIf(!live)('live transcript to embeddings pipeline', () => {
  beforeAll(async () => {
    client = await connect();
    tools = await toolMap(client);
    await deleteExistingTranscript();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('fetches a transcript through the yt-transcripts tool', async () => {
    const result: any = await client.callTool({
      name: toolNamed('ai_sdk_yt_transcripts__', 'fetch_transcript'),
      arguments: { videoId: VIDEO_ID },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.structuredContent)).toContain(VIDEO_ID);
  });

  it('lists the stored transcript', async () => {
    const found = await waitFor(async () => {
      const result: any = await client.callTool({
        name: toolNamed('ai_sdk_yt_transcripts__', 'list_transcripts'),
        arguments: {},
      });
      return JSON.stringify(result.structuredContent).includes(VIDEO_ID);
    });

    expect(found, 'transcript never appeared in list_transcripts').toBe(true);
  });

  it('auto-embeds the transcript via the yt-embeddings lifecycle hook', async () => {
    // The hook subscribes to plugin::ai-sdk-yt-transcripts.transcript. This is
    // the assertion that proves the two plugins are actually wired together.
    const embedded = await waitFor(async () => {
      const result: any = await client.callTool({
        name: toolNamed('ai_sdk_yt_embeddings__', 'list_yt_videos'),
        arguments: {},
      });
      return JSON.stringify(result.structuredContent).includes(VIDEO_ID);
    });

    expect(embedded, 'transcript was never embedded — is the lifecycle hook firing?').toBe(true);
  });

  it('finds the content through semantic search', async () => {
    const result: any = await client.callTool({
      name: toolNamed('ai_sdk_yt_embeddings__', 'search_yt_knowledge'),
      arguments: { query: 'never gonna give you up', limit: 5 },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.structuredContent)).toContain(VIDEO_ID);
  });

  it('keeps every result under the MCP wire limit', async () => {
    const result: any = await client.callTool({
      name: toolNamed('ai_sdk_yt_transcripts__', 'get_transcript'),
      arguments: { videoId: VIDEO_ID },
    });

    const wireBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    expect(wireBytes).toBeLessThan(1_000_000);
  });
});
