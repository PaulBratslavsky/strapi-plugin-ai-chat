import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const TOKEN = process.env.STRAPI_ADMIN_TOKEN;

/** The built-in tools that reach MCP (internal: true tools are excluded). */
export const EXPECTED_BUILTIN_TOOLS = [
  'aggregate_content',
  'create_content',
  'find_one_content',
  'list_content_types',
  'search_content',
  'send_email',
  'update_content',
  'upload_media',
];

/**
 * Connect an MCP client to the official Strapi endpoint. Admin API tokens
 * authenticate here — Content API tokens will not work.
 *
 * The token must grant all three `plugin::ai-sdk.mcp.*` permissions (read,
 * write, destructive). `send_email` in EXPECTED_BUILTIN_TOOLS sits in the
 * `destructive` tier — permission gating filters `tools/list`, so a token
 * missing any one of the three tiers will make tool-exposure assertions fail
 * for the wrong reason (looks like a missing tool, is actually a missing
 * permission).
 */
export async function connect(token: string | undefined = TOKEN): Promise<Client> {
  if (!token) {
    throw new Error(
      'STRAPI_ADMIN_TOKEN is not set. Mint an admin API token in Settings > API Tokens ' +
        '(Admin) with all three "plugin::ai-sdk.mcp.*" permissions (read, write, destructive) ' +
        'and export it before running the E2E suite.',
    );
  }

  const transport = new StreamableHTTPClientTransport(new URL(`${STRAPI_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  const client = new Client({ name: 'ai-sdk-e2e', version: '1.1.0' });
  await client.connect(transport);
  return client;
}

/** Fetch the tool list as a name -> tool map. */
export async function toolMap(client: Client): Promise<Record<string, any>> {
  const { tools } = await client.listTools();
  return Object.fromEntries(tools.map((t: any) => [t.name, t]));
}
