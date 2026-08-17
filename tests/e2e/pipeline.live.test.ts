/**
 * Tier 2 live pipeline E2E test.
 *
 * Exercises the real chain: transcript fetch -> lifecycle hook -> embeddings
 * -> semantic search, all driven over MCP. Requires a running Strapi host
 * (>= 5.47) with `mcp: { enabled: true }`, an admin API token exported as
 * STRAPI_ADMIN_TOKEN, and E2E_LIVE=1 (see `npm run test:e2e:live`). Skipped
 * entirely otherwise. See tests/e2e/client.ts for the connect() helper and
 * its note on required permission tiers.
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

/**
 * Mirrors @strapi/content-manager's internal `slugifyUidForMcpToolName`
 * (server/mcp/utils.js — not a public export, so replicated rather than
 * deep-imported). For a `plugin::` uid it lowercases the namespace, splits
 * the model name on '.', and joins with '_':
 *   plugin::ai-sdk-yt-transcripts.transcript -> plugin-ai-sdk-yt-transcripts_transcript
 */
function slugifyContentTypeUid(uid: string): string {
  const [namespace, modelName] = uid.split('::');
  const parts = modelName.split('.').map((part) => part.toLowerCase());
  if (namespace === 'api') return parts[0];
  return `${namespace.toLowerCase()}-${parts.join('_')}`;
}

const TRANSCRIPT_SLUG = slugifyContentTypeUid(TRANSCRIPT_UID);

/**
 * Delete any existing transcript row(s) for VIDEO_ID via the content-manager
 * derived `list_<slug>` / `delete_<slug>` MCP tools.
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
 * If the content-manager tools aren't available (e.g. the admin token lacks
 * content-manager read/delete permissions on the Transcript content type, or
 * the content type isn't registered as visible), this throws rather than
 * silently letting the suite run against stale data — a loud failure here is
 * more honest than a green run that no longer proves the hook fires.
 */
async function deleteExistingTranscript(): Promise<void> {
  const listName = `list_${TRANSCRIPT_SLUG}`;
  const deleteName = `delete_${TRANSCRIPT_SLUG}`;

  if (!tools[listName] || !tools[deleteName]) {
    throw new Error(
      `Cannot guarantee a fresh run: content-manager tools "${listName}" / "${deleteName}" ` +
        `are not exposed to this MCP session. This suite cannot prove the yt-embeddings ` +
        `lifecycle hook fires without deleting any pre-existing transcript for ${VIDEO_ID} first ` +
        `(fetchTranscript is cache-and-return-early, and the auto-embed hook only fires on ` +
        `afterCreate). Grant the admin token content-manager read + delete permissions on the ` +
        `Transcript content type (${TRANSCRIPT_UID}), or confirm it is still visible to ` +
        `content-manager, then rerun. Refusing to proceed against unverified state. ` +
        `Available tools: ${Object.keys(tools).join(', ')}`,
    );
  }

  const listResult: any = await client.callTool({
    name: listName,
    arguments: { filters: { videoId: VIDEO_ID } },
  });
  const existing: Array<{ documentId: string }> = listResult?.structuredContent?.results ?? [];

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
