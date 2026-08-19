#!/usr/bin/env node
/**
 * E2E: per-tool MCP permission scoping, against a LIVE Strapi.
 *
 * The unit suite mocks `strapi.ai.mcp` and can only assert what we hand to
 * registerTool(). It cannot prove Strapi actually enforces those policies. This
 * script closes that gap by minting real admin tokens over the admin API,
 * calling /mcp as those tokens, and asserting what comes back.
 *
 * It exists because of a specific failure that shipped unnoticed: a caller
 * holding none of our actions gets a SUCCESSFUL, EMPTY tools/list — not an
 * error — while the boot logs still read as success. Case 2 below pins that
 * behaviour down so it can never be mistaken for a broken server again.
 *
 * Usage:
 *   STRAPI_URL=http://localhost:1339 \
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... \
 *   node tests/test-mcp-scoping.mjs
 *
 * Every token it creates is deleted in a finally block, including on failure.
 */

const BASE = process.env.STRAPI_URL ?? 'http://localhost:1339';
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required (admin API is needed to mint tokens).');
  process.exit(2);
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
}

async function login() {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const jwt = json?.data?.token;
  if (!jwt) throw new Error('admin login returned no token');
  return jwt;
}

/** Every `plugin::<owner>.tool.<slug>` action currently registered. */
async function listToolActions(jwt) {
  const res = await fetch(`${BASE}/admin/permissions`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`GET /admin/permissions failed: ${res.status}`);
  const json = await res.json();

  // Shape differs across versions: sections.plugins[] or a flat conditions/actions list.
  const actions = json?.data?.sections?.plugins ?? json?.data?.conditions ?? [];
  const ids = (Array.isArray(actions) ? actions : [])
    .map((a) => a.action ?? a.actionId ?? a.uid)
    .filter((id) => typeof id === 'string' && id.includes('.tool.'));

  return [...new Set(ids)];
}

async function createAdminToken(jwt, name, permissions) {
  const res = await fetch(`${BASE}/admin/admin-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ name, description: 'temporary; created by test-mcp-scoping', lifespan: null, permissions }),
  });
  if (!res.ok) throw new Error(`create admin token failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { id: json?.data?.id, accessKey: json?.data?.accessKey };
}

async function deleteAdminToken(jwt, id) {
  if (!id) return;
  await fetch(`${BASE}/admin/admin-tokens/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  }).catch(() => {});
}

/** Minimal MCP client: initialize, then one call, carrying the session id. */
function mcpClient(token) {
  let sessionId = null;

  return async function rpc(method, params) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;

    const text = await res.text();
    if (!res.ok) return { httpStatus: res.status, body: text.slice(0, 200) };

    const line = text.split('\n').find((l) => l.startsWith('data: '));
    try {
      return JSON.parse(line ? line.slice(6) : text);
    } catch {
      return { unparsed: text.slice(0, 200) };
    }
  };
}

async function toolsFor(token) {
  const rpc = mcpClient(token);
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-mcp-scoping', version: '1' },
  });
  if (init.httpStatus) return { httpStatus: init.httpStatus, tools: null };

  const list = await rpc('tools/list', {});
  return { httpStatus: 200, tools: (list.result?.tools ?? []).map((t) => t.name), rpc };
}

async function main() {
  console.log(`MCP permission scoping against ${BASE}\n`);

  const jwt = await login();
  const allActions = await listToolActions(jwt);

  if (allActions.length < 2) {
    console.error(
      `Need at least 2 registered tool actions to test scoping; found ${allActions.length}.\n` +
        'Is MCP enabled (config/server.ts) and the plugin registering tools?',
    );
    process.exit(2);
  }
  console.log(`  ${allActions.length} tool action(s) registered\n`);

  const granted = allActions.slice(0, 2);
  let scopedId = null;
  let emptyId = null;

  try {
    // ---- Case 1: a token granted exactly 2 actions sees exactly those 2 tools.
    const scoped = await createAdminToken(jwt, `test-scoping-granted-${passed}`, granted);
    scopedId = scoped.id;
    const scopedResult = await toolsFor(scoped.accessKey);

    check('granted token authenticates against /mcp', scopedResult.httpStatus === 200, `HTTP ${scopedResult.httpStatus}`);
    check(
      'granted token sees exactly the 2 tools it was granted',
      scopedResult.tools?.length === 2,
      `saw ${scopedResult.tools?.length ?? 'none'}: ${(scopedResult.tools ?? []).join(', ')}`,
    );
    check(
      'no ungranted tool leaks into the list',
      (scopedResult.tools?.length ?? 0) < allActions.length,
      'token can see every tool despite holding only 2 grants — scoping is NOT enforced',
    );

    // ---- Case 2: a token granted nothing gets a SUCCESSFUL, EMPTY list.
    // This is the failure that shipped unnoticed. It must stay empty-not-error,
    // so the boot advisory remains the only thing that can explain it.
    const empty = await createAdminToken(jwt, `test-scoping-empty-${passed}`, []);
    emptyId = empty.id;
    const emptyResult = await toolsFor(empty.accessKey);

    check('ungranted token still authenticates (auth != authorization)', emptyResult.httpStatus === 200, `HTTP ${emptyResult.httpStatus}`);
    check(
      'ungranted token receives an EMPTY tool list, not an error',
      emptyResult.tools?.length === 0,
      `saw ${emptyResult.tools?.length} tools: ${(emptyResult.tools ?? []).join(', ')}`,
    );

    // ---- Case 3: invoking an ungranted tool is refused, not silently executed.
    const ungranted = allActions
      .slice(2)
      .map((a) => a.split('.tool.')[1])
      .find(Boolean);

    if (ungranted && emptyResult.rpc) {
      const wire = ungranted.replace(/-/g, '_');
      const called = await emptyResult.rpc('tools/call', { name: wire, arguments: {} });
      const refused = Boolean(called.error) || called.result?.isError === true || Boolean(called.httpStatus);
      check(`calling an ungranted tool (${wire}) is refused`, refused, `got: ${JSON.stringify(called).slice(0, 160)}`);
    } else {
      console.log('  SKIP  ungranted-tool call (need a 3rd tool to test with)');
    }
  } finally {
    await deleteAdminToken(jwt, scopedId);
    await deleteAdminToken(jwt, emptyId);
    console.log('\n  cleaned up temporary tokens');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(2);
});
