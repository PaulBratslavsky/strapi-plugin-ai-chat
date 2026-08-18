# Decision: TanStack AI vs Vercel AI SDK

**Date:** 2026-08-18
**Question:** Should the ai-sdk plugin family move from the Vercel AI SDK to TanStack AI?
**Evidence:** a complete parallel port of both plugins on `experiment/tanstack-ai`, plus
an existing TanStack AI deployment in `music-kb`.

## Recommendation

**Keep the Vercel AI SDK in the Strapi plugins. Keep TanStack AI in music-kb's client.**

This is not a verdict on which library is better. Both ports work. The recommendation
turns on a single environmental fact that the marketing comparison on either side does
not mention.

## The decisive finding

The same library was already in use in both codebases, with opposite outcomes:

| | music-kb `client/` | strapi-plugin-ai-sdk |
|---|---|---|
| Module system | `"type": "module"` | `"type": "commonjs"` |
| `moduleResolution` | `bundler` | `Node` |
| Chosen by | the app | **Strapi** — `@strapi/typescript-utils/tsconfigs/server.json` |
| TanStack AI | works well, 16 files, in production | documented API does not type-check |

Under `moduleResolution: "Node"`, TanStack's own documented one-liner —
`embed({ adapter: openaiEmbedding(...), input })` — fails to compile, reporting missing
`kind`, `model`, and `~types`. It compiles cleanly under `bundler`, which is incompatible
with the CommonJS output every Strapi plugin must produce (`TS5095`).

**Ten of the casts in the yt-embeddings port trace to this one issue** — not to loose
typing in TanStack's API design.

### It is worse than a typing problem: the port cannot run

Follow-up investigation (2026-08-18) established that the type errors were a symptom, not
the disease. Verified against the published tarballs:

```
@tanstack/ai@0.45.0        type: module   main: ABSENT
  exports["."] = { "types": "./dist/esm/index.d.ts", "import": "./dist/esm/index.js" }
@tanstack/ai-openai@0.19.1     exports conditions: types, import — no `require`
@tanstack/ai-anthropic@0.16.6  exports conditions: types, import — no `require`
```

There is **no `require` condition and no CJS build** — `dist/` contains only `dist/esm`.
The packages are ESM-only.

This plugin compiles to CommonJS (`"type": "commonjs"`, `strapi-server` → `dist/server/index.js`),
and its build emits `require("ai")` today. A TanStack build would emit
`require("@tanstack/ai")`, which resolves to:

```
ERR_PACKAGE_PATH_NOT_EXPORTED   (verified on Node 22.18.0 AND Node 24.16.0)
```

Node's `require(esm)` support in 22.12+/23+ does not rescue this. Resolution fails *before*
loading, because no condition matching a `require` exists in the `exports` map at all.

**So the TanStack plugin build would fail at Strapi boot.** Not degrade — fail to load.

### The cause is one missing line, not ESM (verified)

It would be easy to conclude "ESM-only packages cannot work in CommonJS Strapi plugins."
That is **wrong**, and the distinction decides how fixable this is.

Controlled experiment — two packages, identical ESM source, differing *only* in their
exports map:

| package | `exports["."]` | `require()` on Node 22.18 & 24.16 |
|---|---|---|
| A | `types`, `import` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| B | `types`, `import`, **`default`** | **OK** — loads and runs |

Then the decisive test against the real package: patching **only** `@tanstack/ai`'s
`package.json` to add one line —

```json
"default": "./dist/esm/index.js"
```

— makes `require('@tanstack/ai')` succeed from CommonJS on **both Node 22.18.0 and
24.16.0**, returning all 122 symbols with `chat` and `toolDefinition` intact. No CJS build.
No transpilation. No consumer-side change.

So the accurate statement is not "TanStack is ESM-only and therefore incompatible." It is:
**Node is willing to `require()` these packages; TanStack's exports map declines to let it.**
Upgrading Node will never fix this — it is a publishing choice, not a runtime limitation,
and the upstream fix is one line.

Worth filing upstream. An `exports` map that omits both `require` and `default` excludes
every CommonJS consumer — which, in the Node backend world, is still most of them.

### An audit gap worth stating plainly

Both TanStack ports type-check, build, and pass 79/79 unit tests — and **neither was ever
executed**. The porting agents were told not to start a Strapi server, because a shared host
was in use for manual testing. That coordination decision was right for the environment and
wrong for the evidence: a green build concealed a hard runtime blocker.

The general lesson outranks the specific finding: *a build that has never run is not
evidence that it works.* The same trap produced this session's other two most serious
findings — a tool-registration path that would kill Strapi at boot, and an E2E test that
silently stopped testing after its first run.

### The one workaround, honestly assessed

`await import('@tanstack/ai')` from CommonJS **does** work (verified: 122 symbols).

But it would force every AI-SDK touchpoint to become async and dynamically loaded, in a
plugin whose provider registration and bootstrap paths are partly synchronous. That is a
structural change to accommodate a dependency's packaging — a poor trade for a library
whose advantages here are concentrated in embeddings ergonomics.

That is the whole decision. TanStack AI is a good library in the environment it targets —
modern ESM, bundler resolution, TanStack Start. A Strapi v5 plugin is the opposite
environment by mandate.

## Where TanStack genuinely wins

Recorded honestly; these are real and would matter in an ESM codebase.

**Embeddings ergonomics.** `dimensions` is a top-level option on `embed()`. Vercel v6
requires `providerOptions: { openai: { dimensions } }` nested inside every call — a
regression introduced when `@ai-sdk/openai@3` dropped `openai.embedding()`'s settings
argument, which we hit for real during the `ai@4 → ai@6` upgrade.

**`embed`/`embedMany` consolidation.** One function, accepts a single value or an array,
always returns `{ embeddings: [{ vector, index }] }` in input order. Cleaner than two
functions with different result shapes.

**Structured output self-heals.** `@tanstack/openai-base`'s `coerceStrictSchema()` widens
`required` to every property and unions `null` onto optional/defaulted fields before
calling OpenAI strict mode. That is exactly the fix we had to perform by hand for Vercel —
stripping `.default('en')` from a Zod field because Zod 4's JSON Schema conversion excludes
defaulted fields from `required`. *(Source-inspected, not runtime-verified.)*

**Tool schemas need no wrapper.** Passing Zod directly removed 4 `as any` casts from
`tools/index.ts`. `toolDefinition()`'s `inputSchema` accepts any Standard-Schema value
natively.

**First-party Ollama adapter.** `@tanstack/ai-ollama` is maintained by the project. Vercel
reaches Ollama through an OpenAI-compatible shim. This matters for the stated local-first
goal, and music-kb already relies on it.

## Where Vercel wins

**Stability posture.** `ai@6.0.39` is stable. The entire TanStack line is pre-1.0 —
`@tanstack/ai@0.45.0`, `ai-anthropic@0.16.6`, `ai-openai@0.19.1`. On a 0.x line, minor
releases may break. For packages published to npm and installed by third parties, that is
a standing liability independent of API quality.

**Bundle size, contrary to the tree-shaking claim.**

| | Size | Packages |
|---|---|---|
| `ai` + `@ai-sdk/openai` | **15M** | 12 |
| `@tanstack/ai` + `@tanstack/ai-openai` | **26M** | 11 |

Fewer packages, ~1.7× the disk, dominated by the official `openai` npm package that
`@tanstack/ai-openai` depends on outright.

**Runtime-configured credentials.** `anthropicText(model, config)` types `config` as
`Omit<AnthropicTextConfig, 'apiKey'>` — it structurally cannot accept an explicit API key
and only reads `ANTHROPIC_API_KEY` from the environment. This plugin's design point is a
key supplied at runtime from Strapi plugin config. The workable function,
`createAnthropicChat(model, apiKey, config)`, appears nowhere in TanStack's own migration
guide; it was found by reading `.d.ts` files after the documented function turned out to
have no `apiKey` field at all.

**Typed model catalogs reject valid model IDs.** `createAnthropicChat` constrains the model
to a literal union of *undated* aliases (`'claude-sonnet-4-6'`). This plugin uses dated
snapshot IDs (`'claude-sonnet-4-20250514'`) — valid, documented Anthropic IDs that are not
in TanStack's list. Any runtime-selected model forces a cast.

**Type safety is a trade, not a win.** −4 casts in `tools/index.ts`, **+8** in the
provider-agnostic `AIProvider` layer, which previously had zero. TanStack's *tool* API is
friendlier to dynamic code than its *chat* API is.

## The cost the file count hides

The advance mapping predicted 9 files to change. The real port touched **12**.

The three extras were `admin/src/utils/sse.ts`, `admin/src/hooks/useChat.ts`, and a smoke
script — the admin chat UI's **hand-rolled SSE parser**, which hard-codes the AI SDK's UI
Message Stream event names (`text-delta`, `tool-input-available`). It imports nothing from
`ai` or `@ai-sdk/*`, so a grep-for-imports pass does not find it, and it is typed loosely
enough that it **breaks silently rather than failing to compile**.

TanStack emits AG-UI events (`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_END`) — a structurally
different protocol, not a renamed one. Adapting it required reverse-engineering that
TanStack fires one `TOOL_CALL_END` event type *twice* per call (input, then output), and
that an answered tool call needs a separate `tool-result` sibling part.

Generalising: a vendor-specific import is greppable. A wire-protocol change is not. Finding
the second consumer required asking "who parses this stream?" — a semantic question, not a
syntactic one. Any future SDK swap should start there.

## What this means per codebase

**Strapi plugins — stay on Vercel.** The `moduleResolution` blocker is decisive, the
stability posture matters for published packages, and the wins TanStack offers are
concentrated in embeddings ergonomics, which is a small part of the surface.

**music-kb client — stay on TanStack.** It is an ESM TanStack Start app; the blocker does
not apply. It already runs `chat`, `toolDefinition`, `toServerSentEventsResponse` and
`createOllamaChat` across 16 files with Ollama, and 14 test files cover the services. There
is no reason to migrate it toward Vercel.

Two codebases, two answers, one library — because the constraint is the module system, not
the API.

## Revisit if

- **TanStack ships a CJS build with a `require` condition in its `exports` map.** This is
  the single change that would remove the primary objection.

  An earlier draft of this document phrased the condition as "a `moduleResolution: "Node"`-compatible
  `exports` map". That was wrong, and the correction matters: `moduleResolution: "Node"`
  (Node10) **never reads the `exports` field at all** — it predates it, and falls back to
  `main`/`types`. No `exports` map can be made compatible with it. TanStack already ships a
  top-level `types` field, which is why the failures were confusing type mismatches rather
  than clean "cannot find module" errors.

  The real ask turned out to be **far smaller than a CJS build**: adding a `default` (or
  `require`) condition to the existing exports map is sufficient, verified above. Node
  loads the ESM entry through `require()` happily once the condition exists. A dual `.d.cts`
  build — as the reference `@tanstack/config` Vite setup documents — would additionally fix
  the *typing* side under `moduleResolution: "Node"`, but is not needed to make the runtime
  work.

  So: one line unblocks running it; a dual build unblocks typing it. Both are theirs to
  make, not ours to work around — though see the demo note below, which does work around it.
- `@tanstack/ai` reaches 1.0 with a stability commitment.
- Strapi relaxes the CommonJS requirement for plugin server code.
- Local-first Ollama inference becomes a hard requirement for the *plugins* (not just
  music-kb), at which point the first-party adapter's value rises sharply.

## Reproducing this

```bash
# per repo
git diff feat/official-strapi-mcp-migration..experiment/tanstack-ai
git show experiment/tanstack-ai:AUDIT-NOTES.md
```

Branches are retained deliberately. They are the evidence; deleting them discards the
audit. If the revisit conditions above are met, rebasing these branches is far cheaper than
redoing the ports.

## One thing worth stealing regardless

The installed `@tanstack/ai` package ships agent-readable skill docs under
`node_modules/@tanstack/ai/skills/` — `chat-experience`, `tool-calling`,
`adapter-configuration`, each with a "Common Mistakes" section. Reading those plus the
`.d.ts` files, rather than the documentation site, is what made the port tractable in one
pass. Shipping machine-readable usage guidance inside the package is a good idea whoever
does it.
