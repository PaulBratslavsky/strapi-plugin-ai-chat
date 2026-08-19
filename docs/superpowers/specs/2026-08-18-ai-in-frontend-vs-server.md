# AI in the frontend vs AI in the server

**Date:** 2026-08-18
**Context:** exploring native AI features for Strapi.
**Evidence:** two live codebases that made opposite choices — `music-kb` (frontend) and
`strapi-plugin-ai-sdk` (server).

## The question

When a CMS-backed product wants AI features, the model call can live in either of two
places:

- **Frontend** — a server route in the web app (TanStack Start, Next.js, Nuxt). It calls
  the model, and fetches CMS data over HTTP when it needs context.
- **Server** — inside Strapi itself. It calls the model, and reaches CMS data directly.

Both keep secrets off the browser: a "server route" in a frontend framework runs on a
server. **Credential safety is not the differentiator**, and any argument that leads with it
is not engaging with the real trade.

The real differences are data locality, reuse, and what the AI is allowed to *be*.

## Two working examples

| | `music-kb` — frontend | `strapi-plugin-ai-sdk` — server |
|---|---|---|
| Where the model is called | TanStack Start server routes (`api.chat.tsx`, `api.ask.tsx`, `api.digest-chat.tsx`, `api.notes.compose.tsx`) | Strapi plugin services |
| SDK | `@tanstack/ai` + `@tanstack/ai-ollama` | `ai` (Vercel) + `@ai-sdk/anthropic` |
| Model | Ollama, local | Anthropic, hosted |
| How AI reaches CMS data | HTTP to Strapi with a shared `STRAPI_API_TOKEN` | `strapi.documents(uid).findMany(...)` in-process |
| Consumers served | one app | admin chat + public widget + MCP clients |
| Strapi's own AI dependency | **none** — embeddings via a plain `fetch()` POST | the SDK itself |

Note the hybrid in the left column: music-kb puts *chat* in the frontend but does
*embeddings* inside Strapi — with no SDK at all, just a `fetch()` to
`http://localhost:11434/api/embeddings`. That split is deliberate and instructive.

## Where the server wins

**1. Data locality — the biggest one.**

A tool-calling loop is not one request. The model calls a tool, reads the result, calls
another. Server-side, each is an in-process query:

```ts
const results = await strapi.documents(contentType).findMany({ filters, fields, sort });
```

Frontend-side, each is an authenticated HTTP round-trip to the CMS. A five-tool-call answer
means five extra network hops, each with serialisation, auth, and latency the server
version simply does not have. It also means the CMS must expose, over HTTP, every shape the
AI might need — widening the API surface for a consumer that is sitting right next to the
database.

**2. One registry, many surfaces.**

The plugin registers tools once into a `ToolRegistry`, and three consumers read from it:
the admin chat, the public widget, and MCP. In the live host that is **21 tools** available
to all three from one definition. Frontend AI serves the app it lives in — a second client
(mobile, CLI, another site) starts from zero.

**3. MCP is only realistically possible here.**

Strapi 5.47+ exposes `/mcp`, letting Claude Desktop, Claude Code and Cursor drive the CMS
directly. Tools registered server-side appear there automatically. This is a genuinely
different capability, not a convenience: it makes the CMS itself addressable by an external
agent. A frontend app cannot offer that for the CMS's data.

**4. Permissions inherit the CMS's model.**

Server-side tools sit inside Strapi's RBAC. This work added three admin permission tiers
(`plugin::ai-sdk.mcp.read` / `.write` / `.maintenance`), so a token can be scoped to
browse-only, or barred from expensive external calls. The frontend approach holds one
shared `STRAPI_API_TOKEN` — a single credential with a fixed grant, the same for every user
of the app.

**5. Enforcement has one choke point.**

Guardrails run as route middleware over every AI entry point. One place to audit. In a
frontend, each route enforces its own — and forgetting one is silent. *(This is not
theoretical: the audit in this repo found `/public-chat` wired to guardrail middleware but
never actually screened, because the path-matching had no branch for it. One choke point
does not mean automatically correct — it means one place to check.)*

## Where the frontend wins

**1. Iteration speed and ownership.**

The AI logic lives with the UI it serves. Prompt changes, streaming tweaks, and rendering
changes ship together, in one deploy, owned by one team. Server-side means a CMS deploy to
change a prompt.

**2. Freedom of stack.**

Frontend apps are ESM and bundler-resolved, so any SDK works. Strapi plugins compile to
CommonJS, and that is a hard constraint: `@tanstack/ai` ships an `exports` map with only
`types` and `import` conditions, so `require('@tanstack/ai')` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED` on Node 22 *and* 24. **This is why music-kb can use TanStack
AI and the plugin cannot** — not a quality judgement, a packaging one.

Put plainly: **the server side restricts your SDK choices; the frontend does not.**

**3. Per-app model choice.**

Different frontends can use different models — one local, one hosted — without negotiating
a shared default in the CMS.

**4. AI load does not touch the CMS.**

Streaming completions hold connections open for tens of seconds. CMS requests are short.
Co-locating them means the CMS process is scaled by AI concurrency, and a runaway agent loop
degrades content editing for everyone.

**5. No framework lock-in.**

Nothing about the AI depends on Strapi's plugin API, lifecycle, or release cadence.

## For Strapi natively: what this suggests

If the goal is native AI features in Strapi core, the evidence points to a specific shape.

**Do put in core: the parts that need to be there.**

Tool registration, permission tiering, and MCP exposure only work well server-side, and
Strapi already started here — `strapi.ai.mcp` exists in 5.47+. That namespace is the right
foundation. The valuable primitive is not "Strapi calls an LLM"; it is **"Strapi exposes its
content and capabilities to an LLM, safely, with permissions."** That is the part nothing
outside Strapi can do well.

**Be cautious about core owning the model call.**

The moment core depends on an AI SDK, it inherits that SDK's release cadence, bundle weight,
and module-format constraints — for every Strapi user, including those who want no AI at
all. The CommonJS finding above shows how sharply that can bite: a popular, well-designed
SDK is simply not loadable in Strapi's plugin format today.

Two lighter options avoid that:

- **Adapter interface.** Core defines the contract (`chat`, `embed`) and ships no
  implementation; users plug in Vercel, TanStack, or their own. Core stays dependency-free
  and un-opinionated about the module format problem.
- **Plain `fetch()` for narrow jobs.** music-kb's entire Ollama embedding integration is a
  ~25-line POST with zero dependencies — and is the only part of that codebase never to have
  had an SDK compatibility problem. For embeddings specifically, an SDK buys retries and a
  typed wrapper around one HTTP call. Weigh that against 15M and 12 packages.

**The strongest argument for AI in the server is not the model call at all.** It is data
locality and permissioned exposure. Those are exactly the things a frontend cannot
replicate, and exactly the things that do not require an SDK dependency in core.

## A reasonable default

Neither location is correct in general. The split music-kb arrived at is defensible and
worth stating as a pattern:

- **Server:** tools, retrieval, embeddings, permissions, MCP — anything that needs the data
  or the permission model.
- **Frontend:** conversation orchestration, streaming UX, prompt iteration — anything that
  needs to move at the UI's pace.

The server exposes *capability*; the frontend composes *experience*. Under that split,
Strapi's job is to be excellent at the first, and to avoid constraining anyone's choices in
the second.

## Open questions

1. If core defines an adapter interface, is the surface `chat` + `embed`, or does tool
   calling need to be in the contract too?
2. Does Strapi want to ship a default implementation, accepting the dependency, or stay
   BYO and accept a worse out-of-box experience?
3. Should MCP tool registration stay SDK-independent? *(It currently is — tools are plain
   Zod schemas plus an execute function, and the MCP layer touches no AI SDK at all. That
   independence is what made a whole-SDK swap in this repo touch zero MCP code. It is worth
   protecting deliberately rather than by accident.)*
4. Does the CommonJS constraint on plugins want revisiting? It is currently the single
   biggest limiter on what the ecosystem can depend on.
