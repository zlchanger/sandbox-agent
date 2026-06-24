# assistant-ui ↔ ACP Example — Design

Date: 2026-06-24
Status: Approved for planning

## Goal

Add a runnable example under `examples/assistant-ui/` that connects [assistant-ui](https://github.com/assistant-ui/assistant-ui) as the frontend to the Sandbox Agent backend over native ACP, and renders the conversation as rich components:

- text (streaming) and reasoning
- tool calls, mapped to four UIs: **chart**, **interactive form**, **image/media**, and a **generic fallback**

The example follows existing repo conventions (pnpm workspace, `workspace:*` deps, Vite + React 19, Hono dev server + `/v1/*` proxy, modeled on `examples/cloudflare`).

## Non-Goals

- No protocol/Rust changes. All example code lives on the TypeScript side.
- No MCP-style `elicitation`. The protocol does not expose it (see "Deferred"). Forms use prompt round-trip.
- Not a styled product UI; styling is minimal/illustrative.

## Background (verified in repo)

- The backend implements ACP over HTTP in **Rust** (`server/packages/sandbox-agent/src/router.rs`, `/v1/acp`: POST JSON-RPC, GET SSE downstream, DELETE close).
- The **client** half is TypeScript: `acp-http-client` (low-level ACP JSON-RPC over HTTP+SSE), wrapped by the `sandbox-agent` SDK (`SandboxAgent.connect()`, `session.prompt()`, `session.onEvent()`, `onPermissionRequest`/`respondPermission`).
- `session.onEvent` yields `SessionEvent { id, eventIndex, sessionId, createdAt, sender, payload }` where `payload` is a raw ACP envelope. The discriminant is `payload.method` and, for updates, `payload.params.update.sessionUpdate` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update` keyed by `toolCallId`, `plan`, etc.). `session/request_permission` arrives as a server-initiated request.
- The existing inspector (`frontend/packages/inspector/src/App.tsx`) already folds these events into a renderable transcript; its accumulation logic is the reference for the reducer below.

## Architecture

```
Browser (assistant-ui)
  │  SandboxAgent.connect({ baseUrl: "/" }) → createSession → session.onEvent (SSE)
  ▼
Hono dev server (src/index.ts)
  │  serves built frontend  +  reverse-proxies /v1/* (incl. SSE) to the sandbox-agent instance
  ▼
sandbox-agent server (ACP, started --no-token)
```

The browser only talks to the same-origin Hono server, which proxies `/v1/*` to the started sandbox-agent (avoids CORS/token handling), reusing the `examples/cloudflare` proxy pattern.

## Runtime choice

Use assistant-ui's **`ExternalStoreRuntime`** (not LocalRuntime). The source of truth is the backend, streamed over SSE; assistant-ui must render our externally-managed message list, not call a model itself. `onNew` sends a prompt; the SSE stream produces the assistant turn.

## Components (isolated units)

| File | Responsibility | Depends on |
|---|---|---|
| `frontend/acp/connection.ts` | `SandboxAgent.connect` + create session; returns `{ session }` | `sandbox-agent` SDK |
| `frontend/acp/eventReducer.ts` | **Pure** `(state, SessionEvent) => state`, folding ACP events into assistant-ui `ThreadMessage[]`. Unit-tested. | none |
| `frontend/acp/useAcpRuntime.ts` | React hook: subscribes to `session.onEvent`, runs the reducer, exposes `{ messages, isRunning, onNew, onCancel }` for `ExternalStoreRuntime` | the two above |
| `frontend/tools/ChartToolUI.tsx` | `makeAssistantToolUI` for `render_chart` → Recharts from `result` data | recharts |
| `frontend/tools/FormToolUI.tsx` | `makeAssistantToolUI` for `collect_form` → renders fields from `args`; on submit sends values back as a new prompt | — |
| `frontend/tools/MediaToolUI.tsx` | `makeAssistantToolUI` for `show_media` → renders image/media from `result` | — |
| `frontend/tools/FallbackToolUI.tsx` | catch-all tool UI: collapsible input/output/status | — |
| `frontend/App.tsx` | `AssistantRuntimeProvider` + `Thread` + register the four tool UIs | assistant-ui |
| `frontend/main.tsx` | React entry | — |
| `src/index.ts` | Hono: start sandbox + `/v1/*` proxy + serve frontend | hono, examples/shared |

## Event → assistant-ui mapping (reducer)

- `session/prompt` (sender=client) → user message
- `agent_message_chunk` → accumulate into the current assistant message text
- `agent_thought_chunk` → reasoning part
- `tool_call` → assistant tool-call part: `toolName` from `title`, `args` from `rawInput`, `status`
- `tool_call_update` (matched by `toolCallId`) → merge `status` / `rawOutput` into the existing part
- `session/request_permission` → a confirmation UI; reply via `respondPermission`
- other `sessionUpdate` kinds (`plan`, usage, mode, etc.) → optional meta entries (low priority)

`onNew(text)` → `session.prompt([{ type: "text", text }])`.

## Tool UI mapping

The example expects these tool names (by convention):

| Tool name | Component | Behavior |
|---|---|---|
| `render_chart` | ChartToolUI | read `result` data → Recharts line/bar chart |
| `show_media` | MediaToolUI | render image/media URL(s) from `result` |
| `collect_form` | FormToolUI | render fields from `args`; **on submit, serialize values and send back as a new `session.prompt`** (human-in-the-loop) |
| `*` (unmatched) | FallbackToolUI | generic input/output/status display |

### Form round-trip (decision)

Forms submit by sending the collected values back as a new user prompt (`session.prompt`). This is the only structured-form path that works today and is agent-agnostic. The agent receives the values as text. Constraint documented in code comments.

## Demo driver (decision)

Default to driving the demo with the repo's **`mock-acp-agent`**, scripted to emit `render_chart`, `collect_form`, and `show_media` tool calls plus text — deterministic, no API key, exercises all four tool UIs. The connection layer stays generic, so pointing the example at a real agent (claude/codex) also works; real-agent tool calls (bash/read/edit) render via `FallbackToolUI`. Real agents will not emit the chart/form/media tools without extra tooling, so the out-of-box rich demo relies on the mock agent.

## File structure

```
examples/assistant-ui/
├── package.json            @sandbox-agent/example-assistant-ui (workspace:* deps)
├── vite.config.ts          root: "frontend", outDir "../dist"
├── tsconfig.json
├── README.md
├── src/index.ts            Hono: start sandbox (examples/shared) + /v1/* proxy + serve frontend
└── frontend/
    ├── main.tsx
    ├── App.tsx
    ├── acp/{connection,eventReducer,useAcpRuntime}.ts
    └── tools/{ChartToolUI,FormToolUI,MediaToolUI,FallbackToolUI}.tsx
```

## Testing

- `eventReducer.ts`: vitest unit tests — feed representative ACP event sequences (streaming chunks, tool_call + tool_call_update by id, permission request) and assert the produced messages/tool parts.
- `pnpm typecheck` for the package.
- Manual run-through against `mock-acp-agent`, verifying all four tool UIs render.

## Deferred (recorded, not implemented)

True structured-form / elicitation round-trip:
- `elicit` exists nowhere in the repo or the ACP SDK; MCP elicitation is not wired through.
- A relevant extension already exists: `_sandboxagent/session/request_question` (dispatched in `server/packages/opencode-adapter/src/lib.rs`), a generic HITL question/form request. Reusing it is cheaper than a new method.
- Adding a new server→client request (`_sandboxagent/session/elicit`) would touch ~5 layers across Rust + TS (opencode-adapter `match method` + `resolve_*_inner`, `acp-http-client` `Client` interface, TS SDK `LiveAcpConnection`/`Session`, CLI const), because there is no generic client-side dispatch for server-initiated requests.
- Server-initiated requests can only be emitted by the agent process; a real agent won't emit them without being built to.

## Open questions

None blocking. Demo driver and form round-trip decided above.
