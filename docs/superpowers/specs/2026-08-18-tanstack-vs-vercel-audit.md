# Audit: TanStack AI vs Vercel AI SDK

**Date:** 2026-08-18
**Purpose:** Build a like-for-like TanStack AI port of the ai-sdk plugin family so the
two SDKs can be compared on real code rather than marketing pages.

## Method

`experiment/tanstack-ai` is branched from `feat/official-strapi-mcp-migration` in each
repo. The audit artifact is therefore one command:

```
git diff feat/official-strapi-mcp-migration..experiment/tanstack-ai
```

Every line that differs between the two solutions, in one place. Behaviour must stay
identical — this is a swap, not a redesign. Any behaviour change is a finding, not a
liberty.

## What makes this cheap (and what it says about the architecture)

The MCP migration already isolated the AI SDK behind a seam. `ToolRegistry` holds
provider-agnostic objects — `{ name, description, zod schema, execute }` — and the SDK
only enters when those are wrapped for a chat call. Consequently:

- **Untouched:** the whole MCP layer (Strapi owns transport; schemas are plain Zod),
  `ToolRegistry`, every file under `tool-logic/`, all 8 built-in tool definitions,
  guardrails, routes, permissions, and `yt-transcripts` (no AI SDK usage at all).
- **Touched:** `lib/ai-provider.ts`, `tools/index.ts`, the chat services, and
  `yt-embeddings`' four embed/generate files.

That the swap is confined to a handful of files is itself an audit result: it says the
plugin's abstraction boundary is in the right place.

## Version posture (recorded 2026-08-18)

| | Vercel | TanStack |
|---|---|---|
| core | `ai@^6.0.39` (stable) | `@tanstack/ai@0.45.0` (0.x) |
| Anthropic | `@ai-sdk/anthropic@^3.0.15` | `@tanstack/ai-anthropic@0.16.6` |
| OpenAI | `@ai-sdk/openai@^3` | `@tanstack/ai-openai@0.19.1` |

The entire TanStack line is pre-1.0. For a package published to npm and installed by
third parties, that is a standing risk regardless of how good the API is.

## API mapping (from TanStack's own migration guide)

| Vercel | TanStack |
|---|---|
| `streamText()` | `chat()` → `AsyncIterable<StreamChunk>` |
| `generateText()` | `chat({ stream: false })` → `Promise<string>` |
| `generateObject()` | `chat({ outputSchema })` |
| `embed()` + `embedMany()` | `embed()` (consolidated; always returns an array) |
| `tool({ inputSchema, execute })` | `toolDefinition({...}).server(fn)` |
| `zodSchema(schema)` | pass Zod directly — no wrapper |
| `tools: { name: tool }` | `tools: [toolInstance]` (array, not keyed object) |
| `convertToModelMessages()` | not needed |
| `stepCountIs(n)` | `maxIterations(n)` |
| `createAnthropic()(model)` | `anthropicText(model)` |
| `result.toUIMessageStreamResponse()` | `toServerSentEventsResponse(stream)` |

**Declared to have no equivalent:** partial object streaming, built-in `maxRetries`,
built-in `timeout` (use `AbortSignal.timeout()`).

## Criteria — record evidence for each, both sides

Implementers must fill these in from what they actually hit, not from expectations.

1. **Files and lines changed.** Raw diffstat of the swap.
2. **Anything that did not map.** Every place the guide's table was insufficient, what
   was done instead, and whether behaviour changed.
3. **Type safety.** Did types catch mistakes during the port, or did anything require
   `as any`? Count and justify each escape hatch on both sides.
4. **Tool-calling ergonomics.** The registry stores plain objects; compare the wrapping
   code needed to reach a working tool call. Note that TanStack's array-of-instances
   differs from Vercel's keyed object — does that complicate dynamic registration from
   an arbitrary plugin list?
5. **Streaming.** The admin chat and public widget consume a UI message stream. Does the
   SSE shape TanStack emits still drive the existing frontend unchanged? If the client
   needed changes, that is a significant cost the file count would hide.
6. **Embeddings.** `embed`/`embedMany` consolidation — any behavioural difference in
   batching, ordering, or return shape.
7. **Dependency weight.** `du -sh` of each SDK's install footprint, and the count of
   transitive packages.
8. **Runtime parity.** Same prompt, same tools, against a live host: does the TanStack
   build produce equivalent results? Any latency difference worth noting.
9. **Ollama path.** The maintainer wants local-first inference. `@tanstack/ai-ollama`
   exists as a first-party adapter; Vercel reaches Ollama via an OpenAI-compatible
   endpoint. Assess which is less friction — this is a stated project goal, not a
   hypothetical.
10. **Beta friction.** Missing docs, wrong docs, breaking changes between 0.x releases,
    gaps you had to work around.

## Non-goals

- Not redesigning the plugin. Behaviour parity is the constraint.
- Not porting `yt-transcripts` (it has no AI SDK usage).
- Not touching the MCP layer — its independence from the AI SDK is a finding, not a task.
- Not deciding the winner inside the implementation. Implementers gather evidence; the
  comparison is judged afterwards against these criteria.
