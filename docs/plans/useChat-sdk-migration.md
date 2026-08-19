# Plan: adopt `UIMessage` end to end

Status: not started. Two changes, in order, each on its own branch. To be done
after 2.0.1 is verified in production.

1. [Storage: persist `UIMessage[]`, versioned and validated](#change-1--storage)
2. [Rendering: use `useChat` from `@ai-sdk/react`](#change-2--rendering)

The order matters. Doing the swap first means maintaining a mapping layer
between two representations forever; doing storage first makes the swap almost
subtraction.

## The problem

The server already speaks the SDK's protocol — `controller.chat` returns
`result.toUIMessageStreamResponse()` with `x-vercel-ai-ui-message-stream: v1`.
Both the client parser and the storage format are hand-rolled alternatives to a
format the library already defines.

### The storage format has no contract

```ts
// server/src/controllers/conversation.ts
const { title, messages } = ctx.request.body as { title?: string; messages?: unknown[] };
data.messages = messages;   // straight into a "type": "json" field
```

Nothing validates it. The schema is implicit: whatever the admin panel's
`Message` type happened to be when the row was written. Different plugin
versions may already have written different shapes, and there is no way to tell
without reading rows.

### The current shape loses information

```ts
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;          // one accumulated string
  toolCalls?: ToolCall[];   // a flat list beside it
}
```

When the model says *"let me search…"* → calls a tool → *"here's what I
found"*, **the ordering is unrecoverable**. `useChat.ts` accumulates all text
into `content` via `onTextDelta` and appends tool calls to a separate array, so
the interleaving is discarded at write time. This is a limitation today, not a
hypothetical.

`UIMessage.parts[]` is an ordered discriminated union and represents it exactly:

```ts
parts: [
  { type: 'text', text: 'Let me search…' },
  { type: 'tool-searchContent', state: 'output-available', input, output },
  { type: 'text', text: "Here's what I found" },
]
```

### It blocks every future feature

Each capability below is a part type in the SDK — no schema change, no new
storage field, one more case in a render switch:

| Feature | Part type |
|---|---|
| Extended thinking | `reasoning` |
| Citations | `source-url`, `source-document` |
| Attachments | `file` |
| Streaming tool arguments | `tool-*` with `state: 'input-streaming'` |
| Interleaved multi-tool turns | ordered `parts[]` |

Under `{content, toolCalls}` each one needs a bespoke field and bespoke
rendering, and the storage format changes again every time.

---

## Change 1 — Storage

Persist `UIMessage[]`, versioned, validated on the server.

### Envelope

```jsonc
{ "v": 2, "messages": [ /* UIMessage[] */ ] }
```

A bare array means v1 — the legacy `Message[]` shape.

### Server-side validation

Add a Zod schema for the stored payload and validate in `conversation.create`
and `conversation.update`, which currently accept `unknown[]`. The content type
is server-owned, so the contract belongs here rather than in the admin panel; a
malformed or outdated client should be rejected, not silently persisted.

`server/src/lib/` has no validation helper yet — `json-coercible.ts` is the
closest neighbour and a reasonable place to sit beside.

### Migration: on read, not a script

In `conversation.findOne` and `find`, normalize whatever is stored:

- object with `v: 2` → use as-is
- bare array → v1, convert each `Message` to a `UIMessage`
- anything else → log and return empty rather than crashing the panel

Conversion is `content` → a single `text` part, then each `toolCall` → a
`tool-<name>` part with `state` derived from whether `output` is present. Order
between text and tools cannot be recovered, because it was never stored — text
first, then tools, is the honest reconstruction.

Rows heal as they are opened. No downtime, no coordinated deploy, no script to
run and forget.

**Write v2 on every save**, so a conversation converts permanently the first
time it is touched.

### Verification

- Load a v1 conversation saved by 2.0.x — renders identically
- Continue it, save, reload — now stored as v2, still correct
- A v2 conversation round-trips unchanged
- Malformed `messages` in the request body is rejected with a clear 400
- A corrupt row logs and degrades to empty rather than breaking the page

---

## Change 2 — Rendering

With storage speaking `UIMessage`, this is mostly deletion.

### Remove

| File | Lines | Why |
|---|---|---|
| `admin/src/utils/sse.ts` | 91 | the SDK owns protocol parsing |
| most of `admin/src/hooks/useChat.ts` | 165 | replaced by the SDK's `useChat` |

The mapping functions go too — `toUIMessages()` and its inverse — since both
sides now use the same type.

### Add

`useChat` from `@ai-sdk/react`, with a `DefaultChatTransport` pointed at
`${getBackendURL()}/${PLUGIN_ID}/chat`, carrying `Authorization: Bearer
${getToken()}` and `enabledToolSources` in the body. The widget used exactly
this against this server before it moved out, so the pattern is known to work.

Read the token **per request**, not once at hook creation — a token refreshed
mid-session would otherwise produce a 401 that looks like a server fault.

`@ai-sdk/react` returns as a dependency. It was removed in 2.0.1 as genuinely
unused; it becomes legitimate again once imported. Pin to `^3.x` to stay in
lockstep with `ai@6`, matching the convention already used here.

### What this fixes

The hand parser handles three event types: `text-delta`,
`tool-input-available`, `tool-output-available`. Everything else in the protocol
is dropped:

- **`error`** — a stream-level failure produces no `text-delta`, so the UI shows
  a bare "Something went wrong" with no cause. This is the most likely
  explanation for the unexplained "network error" seen during development.
- **`tool-input-start` / `tool-input-delta`** — a slow tool call currently looks
  like a hang, since nothing renders until its input is complete.
- **`reasoning`**, **`abort`** — dropped entirely; a cancelled stream is
  indistinguishable from a crash.

### Consumers

`MessageList.tsx` and `ToolCallDisplay.tsx` currently import `Message` and
`ToolCall`. They move to rendering `parts[]` — a switch over part type, which is
also what makes future part types cheap. `useConversations.ts` changes only in
the type it passes through.

### Verification

Typechecking proves nothing here; this is all streaming behaviour.

- [ ] Plain message streams token by token
- [ ] Tool call renders: name, then input, then output
- [ ] A multi-step loop (search → answer) renders **in the right order** — the
      thing v1 could not represent
- [ ] Killing the server mid-stream shows a real error, not a silent stall.
      Confirm this fails before the change and passes after; it is the
      regression the swap is meant to fix
- [ ] Tool source toggles still filter the toolset
- [ ] Switching conversations resets cleanly

---

## Why not one change

A streaming bug and a data bug look identical from the UI — a message that
renders wrong. Landing storage first means that when something misbehaves during
the swap, the data layer is already known-good and the search space is half the
size.
