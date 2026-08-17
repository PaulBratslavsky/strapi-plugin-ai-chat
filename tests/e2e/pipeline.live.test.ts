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

describe.skipIf(!live)('live transcript to embeddings pipeline', () => {
  beforeAll(async () => {
    client = await connect();
    tools = await toolMap(client);
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
