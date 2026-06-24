# assistant-ui ↔ ACP Example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runnable `examples/assistant-ui/` that wires the assistant-ui React chat UI to the Sandbox Agent backend over the `sandbox-agent` TypeScript SDK, rendering text + tool calls as chart / form / media / fallback UIs, driven by a real agent calling custom MCP tools.

**Architecture:** A Node entry (`src/index.ts`) starts a Docker sandbox (`startDockerSandbox`), uploads a bundled stdio MCP server exposing `render_chart`/`collect_form`/`show_media`, then runs a Hono server that serves the built Vite frontend and reverse-proxies all other paths to the sandbox. The browser uses `SandboxAgent.connect({ baseUrl })` (same-origin via the proxy), creates a session referencing the uploaded MCP server, and feeds the SSE event stream through a pure reducer into assistant-ui's `ExternalStoreRuntime`. Four `makeAssistantToolUI` components render the tool calls.

**Tech Stack:** TypeScript, React 19, Vite 6, Hono 4, `@assistant-ui/react`, `recharts`, `@modelcontextprotocol/sdk`, `zod`, `esbuild`, `vitest`; `sandbox-agent` + `@sandbox-agent/example-shared` workspace packages.

## Global Constraints

- Package name: `@sandbox-agent/example-assistant-ui`; `"private": true`; `"type": "module"`. Lives at `examples/assistant-ui/` (pnpm workspace picks up `examples/*`).
- Workspace deps use `workspace:*`: `sandbox-agent`, `@sandbox-agent/example-shared`. Package manager: `pnpm@9.15.0`. Node ≥ 22 (matches Docker FULL image `node:22`).
- Build entirely on the high-level `sandbox-agent` SDK. Do NOT hardcode ACP endpoint paths (`/v1/acp` etc.) or call `acp-http-client` directly. Do NOT copy the stale `examples/cloudflare` SDK calls (`streamEvents`, `postMessage`, `createSession(id, {...})`) — they no longer exist. Use the current surface: `SandboxAgent.connect({ baseUrl })`, `client.writeFsFile(...)`, `client.createSession({ agent, sessionInit })`, `session.onEvent(...)`, `session.prompt([...])`, `session.onPermissionRequest(...)`, `session.respondPermission(id, reply)`.
- The Hono proxy is a catch-all forward to the sandbox base URL (so it is endpoint-path agnostic).
- Docker FULL image pin: `rivetdev/sandbox-agent:0.4.2-full` (provided by `@sandbox-agent/example-shared/docker`, do not re-pin here).
- Agent selection via `detectAgent()` from `@sandbox-agent/example-shared`; requires credentials (e.g. `ANTHROPIC_API_KEY`) in the environment, collected automatically by `startDockerSandbox`.
- No em dashes in any user-facing copy (README). This is a code example, not docs under `docs/**`; no ACP-terminology restriction applies, but keep README task-focused.
- MCP tool names may surface in ACP `tool_call.title` namespaced (e.g. `mcp__sandboxUi__render_chart`). The reducer MUST normalize to the final segment so `makeAssistantToolUI({ toolName: "render_chart" })` matches.

---

### Task 1: Scaffold the example package

**Files:**
- Create: `examples/assistant-ui/package.json`
- Create: `examples/assistant-ui/tsconfig.json`
- Create: `examples/assistant-ui/vite.config.ts`
- Create: `examples/assistant-ui/vitest.config.ts`
- Create: `examples/assistant-ui/.gitignore`
- Create: `examples/assistant-ui/frontend/index.html`

**Interfaces:**
- Produces: an installable workspace package with scripts `build:mcp`, `build`, `start`, `typecheck`, `test`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@sandbox-agent/example-assistant-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "build:mcp": "esbuild mcp/server.ts --bundle --format=cjs --platform=node --target=node18 --outfile=dist/mcp-server.cjs",
    "build": "vite build",
    "start": "pnpm build:mcp && pnpm build && tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@assistant-ui/react": "latest",
    "@modelcontextprotocol/sdk": "latest",
    "@sandbox-agent/example-shared": "workspace:*",
    "hono": "^4.12.2",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "recharts": "^2.15.0",
    "sandbox-agent": "workspace:*",
    "zod": "latest"
  },
  "devDependencies": {
    "@hono/node-server": "^1.13.0",
    "@types/node": "latest",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    "esbuild": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vite": "^6.2.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "frontend", "mcp"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "frontend",
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```
dist
node_modules
```

- [ ] **Step 6: Write `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>assistant-ui + Sandbox Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Install and verify typecheck baseline**

Run: `pnpm install && pnpm --filter @sandbox-agent/example-assistant-ui typecheck`
Expected: install succeeds; typecheck passes (no source files referencing missing modules yet — `include` dirs are empty so tsc reports success).

- [ ] **Step 8: Commit**

```bash
git add examples/assistant-ui/package.json examples/assistant-ui/tsconfig.json examples/assistant-ui/vite.config.ts examples/assistant-ui/vitest.config.ts examples/assistant-ui/.gitignore examples/assistant-ui/frontend/index.html pnpm-lock.yaml
git commit -m "chore(examples/assistant-ui): scaffold package"
```

---

### Task 2: MCP tool definitions (testable) + stdio server

**Files:**
- Create: `examples/assistant-ui/mcp/tools.ts`
- Create: `examples/assistant-ui/mcp/tools.test.ts`
- Create: `examples/assistant-ui/mcp/server.ts`

**Interfaces:**
- Produces:
  - `chartInputShape`, `formInputShape`, `mediaInputShape` (zod raw shapes used by both the MCP server and tests)
  - `handleChart(args)`, `handleForm(args)`, `handleMedia(args)` returning `{ content: [{ type: "text", text: string }] }`
  - Tool names exposed to the agent: `render_chart`, `collect_form`, `show_media`.
- Consumes: `@modelcontextprotocol/sdk`, `zod`.

- [ ] **Step 1: Write the failing test `mcp/tools.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { handleChart, handleForm, handleMedia } from "./tools";

describe("mcp tool handlers", () => {
  it("chart handler acknowledges and echoes series count", () => {
    const res = handleChart({
      title: "Sales",
      kind: "bar",
      data: [{ label: "Jan", value: 10 }, { label: "Feb", value: 20 }],
    });
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toContain("2");
  });

  it("form handler acknowledges field count", () => {
    const res = handleForm({
      title: "Contact",
      fields: [{ name: "email", label: "Email", type: "text" }],
    });
    expect(res.content[0].text).toContain("1");
  });

  it("media handler echoes the url", () => {
    const res = handleMedia({ url: "https://example.com/a.png", alt: "a" });
    expect(res.content[0].text).toContain("https://example.com/a.png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui test`
Expected: FAIL — cannot resolve `./tools`.

- [ ] **Step 3: Write `mcp/tools.ts`**

```typescript
import { z } from "zod";

export const chartInputShape = {
  title: z.string().describe("Chart title"),
  kind: z.enum(["line", "bar"]).describe("Chart type"),
  data: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .describe("Data points to plot"),
};

export const formInputShape = {
  title: z.string().describe("Form title"),
  fields: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(["text", "number", "email"]).default("text"),
      }),
    )
    .describe("Fields the user should fill in"),
};

export const mediaInputShape = {
  url: z.string().describe("Image or media URL to display"),
  alt: z.string().default("").describe("Alt text"),
};

type ChartArgs = { title: string; kind: "line" | "bar"; data: { label: string; value: number }[] };
type FormArgs = { title: string; fields: { name: string; label: string; type?: string }[] };
type MediaArgs = { url: string; alt?: string };

type ToolResult = { content: { type: "text"; text: string }[] };

export function handleChart(args: ChartArgs): ToolResult {
  return { content: [{ type: "text", text: `Rendered chart "${args.title}" with ${args.data.length} points.` }] };
}

export function handleForm(args: FormArgs): ToolResult {
  return { content: [{ type: "text", text: `Presented form "${args.title}" with ${args.fields.length} fields. Awaiting user input.` }] };
}

export function handleMedia(args: MediaArgs): ToolResult {
  return { content: [{ type: "text", text: `Displayed media: ${args.url}` }] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui test`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `mcp/server.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  chartInputShape,
  formInputShape,
  mediaInputShape,
  handleChart,
  handleForm,
  handleMedia,
} from "./tools";

async function main() {
  const server = new McpServer({ name: "sandboxUi", version: "1.0.0" });

  server.tool(
    "render_chart",
    "Render a line or bar chart in the UI. Pass the data to plot.",
    chartInputShape,
    async (args) => handleChart(args as never),
  );
  server.tool(
    "collect_form",
    "Show a form in the UI to collect input from the user.",
    formInputShape,
    async (args) => handleForm(args as never),
  );
  server.tool(
    "show_media",
    "Display an image or media URL in the UI.",
    mediaInputShape,
    async (args) => handleMedia(args as never),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
```

- [ ] **Step 6: Verify the MCP bundle builds**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui build:mcp`
Expected: writes `dist/mcp-server.cjs` with no errors.

- [ ] **Step 7: Commit**

```bash
git add examples/assistant-ui/mcp
git commit -m "feat(examples/assistant-ui): add MCP server exposing chart/form/media tools"
```

---

### Task 3: Event reducer (ACP events -> assistant-ui messages)

**Files:**
- Create: `examples/assistant-ui/frontend/acp/eventReducer.ts`
- Create: `examples/assistant-ui/frontend/acp/eventReducer.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` type from `sandbox-agent`; `ThreadMessageLike` from `@assistant-ui/react`.
- Produces:
  - `type ReducerState = { messages: ThreadMessageLike[] }`
  - `const initialState: ReducerState`
  - `function normalizeToolName(raw: string): string`
  - `function reduce(state: ReducerState, event: SessionEvent): ReducerState`

- [ ] **Step 1: Write the failing test `frontend/acp/eventReducer.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { initialState, reduce, normalizeToolName, type ReducerState } from "./eventReducer";
import type { SessionEvent } from "sandbox-agent";

function ev(partial: Partial<SessionEvent> & { payload: unknown }): SessionEvent {
  return {
    id: Math.random().toString(36).slice(2),
    eventIndex: 0,
    sessionId: "s1",
    createdAt: 0,
    connectionId: "c1",
    sender: "agent",
    ...partial,
  } as SessionEvent;
}

describe("normalizeToolName", () => {
  it("keeps a plain snake_case name", () => {
    expect(normalizeToolName("render_chart")).toBe("render_chart");
  });
  it("strips an mcp namespace prefix", () => {
    expect(normalizeToolName("mcp__sandboxUi__render_chart")).toBe("render_chart");
  });
  it("strips a slash/dot prefix", () => {
    expect(normalizeToolName("sandboxUi/show_media")).toBe("show_media");
    expect(normalizeToolName("sandboxUi.show_media")).toBe("show_media");
  });
});

describe("reduce", () => {
  it("adds a user message from session/prompt", () => {
    const s = reduce(initialState, ev({
      sender: "client",
      payload: { method: "session/prompt", params: { prompt: [{ type: "text", text: "hi" }] } },
    }));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("user");
    expect(s.messages[0].content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("accumulates assistant message chunks into one message", () => {
    let s: ReducerState = initialState;
    s = reduce(s, ev({ payload: { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } } } } }));
    s = reduce(s, ev({ payload: { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } } } } }));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("assistant");
    expect(s.messages[0].content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("adds a tool-call part with normalized name and merges its update", () => {
    let s: ReducerState = initialState;
    s = reduce(s, ev({ payload: { method: "session/update", params: { update: {
      sessionUpdate: "tool_call", toolCallId: "t1", title: "mcp__sandboxUi__render_chart",
      status: "pending", rawInput: { title: "X", kind: "bar", data: [] },
    } } } }));
    s = reduce(s, ev({ payload: { method: "session/update", params: { update: {
      sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: { ok: true },
    } } } }));
    const part = (s.messages.at(-1)!.content as any[]).find((p) => p.type === "tool-call");
    expect(part.toolName).toBe("render_chart");
    expect(part.toolCallId).toBe("t1");
    expect(part.args).toEqual({ title: "X", kind: "bar", data: [] });
    expect(part.result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui test`
Expected: FAIL — cannot resolve `./eventReducer`.

- [ ] **Step 3: Write `frontend/acp/eventReducer.ts`**

```typescript
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { SessionEvent } from "sandbox-agent";

export type ReducerState = { messages: ThreadMessageLike[] };
export const initialState: ReducerState = { messages: [] };

type Raw = Record<string, unknown>;
type Part = { type: "text"; text: string } | { type: "reasoning"; text: string } | ToolCallPart;
type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
};

/** MCP tools may surface as `mcp__server__tool`, `server/tool`, or `server.tool`. Keep the final segment. */
export function normalizeToolName(raw: string): string {
  let name = raw;
  if (name.includes("__")) name = name.slice(name.lastIndexOf("__") + 2);
  if (name.includes("/")) name = name.slice(name.lastIndexOf("/") + 1);
  if (name.includes(".")) name = name.slice(name.lastIndexOf(".") + 1);
  return name;
}

function asText(content: unknown): string {
  const c = content as Raw | undefined;
  if (c && c.type === "text" && typeof c.text === "string") return c.text;
  return "";
}

function cloneMessages(state: ReducerState): ThreadMessageLike[] {
  return state.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...(m.content as Part[])] : m.content }));
}

function ensureAssistant(messages: ThreadMessageLike[]): ThreadMessageLike {
  const last = messages.at(-1);
  if (last && last.role === "assistant" && Array.isArray(last.content)) return last;
  const created: ThreadMessageLike = { role: "assistant", content: [] };
  messages.push(created);
  return created;
}

function appendText(state: ReducerState, text: string, kind: "text" | "reasoning"): ReducerState {
  if (!text) return state;
  const messages = cloneMessages(state);
  const msg = ensureAssistant(messages);
  const parts = msg.content as Part[];
  const last = parts.at(-1);
  if (last && last.type === kind) {
    parts[parts.length - 1] = { type: kind, text: last.text + text } as Part;
  } else {
    parts.push({ type: kind, text } as Part);
  }
  return { messages };
}

function addToolCall(state: ReducerState, update: Raw): ReducerState {
  const messages = cloneMessages(state);
  const msg = ensureAssistant(messages);
  const parts = msg.content as Part[];
  parts.push({
    type: "tool-call",
    toolCallId: String(update.toolCallId ?? ""),
    toolName: normalizeToolName(String(update.title ?? "")),
    args: update.rawInput ?? {},
  });
  return { messages };
}

function updateToolCall(state: ReducerState, update: Raw): ReducerState {
  const id = String(update.toolCallId ?? "");
  const messages = cloneMessages(state);
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    const parts = msg.content as Part[];
    const idx = parts.findIndex((p) => p.type === "tool-call" && p.toolCallId === id);
    if (idx >= 0) {
      const existing = parts[idx] as ToolCallPart;
      parts[idx] = {
        ...existing,
        result: "rawOutput" in update ? update.rawOutput : existing.result,
      };
      break;
    }
  }
  return { messages };
}

export function reduce(state: ReducerState, event: SessionEvent): ReducerState {
  const payload = (event.payload ?? {}) as Raw;
  const method = typeof payload.method === "string" ? payload.method : null;
  const params = (payload.params ?? {}) as Raw;

  if (event.sender === "client" && method === "session/prompt") {
    const prompt = params.prompt;
    const text = Array.isArray(prompt)
      ? prompt.map((p) => asText(p)).join("")
      : typeof prompt === "string"
        ? prompt
        : "";
    if (!text) return state;
    return { messages: [...state.messages, { role: "user", content: [{ type: "text", text }] }] };
  }

  if (method === "session/update") {
    const update = (params.update ?? {}) as Raw;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return appendText(state, asText(update.content), "text");
      case "agent_thought_chunk":
        return appendText(state, asText(update.content), "reasoning");
      case "tool_call":
        return addToolCall(state, update);
      case "tool_call_update":
        return updateToolCall(state, update);
      default:
        return state;
    }
  }
  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui test`
Expected: PASS (all reducer + normalizeToolName tests).

- [ ] **Step 5: Commit**

```bash
git add examples/assistant-ui/frontend/acp/eventReducer.ts examples/assistant-ui/frontend/acp/eventReducer.test.ts
git commit -m "feat(examples/assistant-ui): add ACP event reducer"
```

---

### Task 4: ACP connection + assistant-ui runtime hook

**Files:**
- Create: `examples/assistant-ui/frontend/acp/connection.ts`
- Create: `examples/assistant-ui/frontend/acp/useAcpRuntime.ts`

**Interfaces:**
- Consumes: `reduce`, `initialState` from `./eventReducer`; `SandboxAgent`, `Session` from `sandbox-agent`; `useExternalStoreRuntime`, `ThreadMessageLike` from `@assistant-ui/react`.
- Produces:
  - `async function connectSession(opts: { baseUrl: string; agent: string; mcpServerPath: string }): Promise<Session>`
  - `function useAcpRuntime(session: Session | null)` returning the value of `useExternalStoreRuntime`.

- [ ] **Step 1: Write `frontend/acp/connection.ts`**

```typescript
import { SandboxAgent, type Session } from "sandbox-agent";

export async function connectSession(opts: {
  baseUrl: string;
  agent: string;
  mcpServerPath: string;
}): Promise<Session> {
  const client = await SandboxAgent.connect({ baseUrl: opts.baseUrl });

  // Wait for the backend to be reachable.
  for (let i = 0; i < 60; i++) {
    try {
      await client.getHealth();
      break;
    } catch {
      if (i === 59) throw new Error("Timed out waiting for sandbox-agent");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return client.createSession({
    agent: opts.agent,
    sessionInit: {
      cwd: "/root",
      mcpServers: [
        { name: "sandboxUi", command: "node", args: [opts.mcpServerPath], env: [] },
      ],
    },
  });
}
```

> Note: `client.getHealth()` is the current health check on the SDK. If the method name differs at implementation time, grep `sdks/typescript/src/client.ts` for the health method and use the actual name — do not invent one.

- [ ] **Step 2: Write `frontend/acp/useAcpRuntime.ts`**

```typescript
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Session } from "sandbox-agent";
import { initialState, reduce, type ReducerState } from "./eventReducer";

function appendMessageText(message: AppendMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function useAcpRuntime(session: Session | null) {
  const [state, setState] = useState<ReducerState>(initialState);
  const [isRunning, setIsRunning] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    if (!session) return;
    // Auto-approve permission requests so the demo flows without a permission UI.
    const offPerm = session.onPermissionRequest((req) => {
      session.respondPermission(req.id, "once").catch(() => {});
    });
    const offEvent = session.onEvent((event) => {
      setState((prev) => reduce(prev, event));
    });
    return () => {
      offPerm();
      offEvent();
    };
  }, [session]);

  return useExternalStoreRuntime({
    messages: state.messages,
    isRunning,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async (message: AppendMessage) => {
      const s = sessionRef.current;
      if (!s) return;
      const text = appendMessageText(message);
      if (!text) return;
      setState((prev) => ({
        messages: [...prev.messages, { role: "user", content: [{ type: "text", text }] }],
      }));
      setIsRunning(true);
      try {
        await s.prompt([{ type: "text", text }]);
      } finally {
        setIsRunning(false);
      }
    },
  });
}
```

> Note on form round-trip: `useAcpRuntime` exposes message sending via `onNew`. The FormToolUI (Task 5) submits collected values by calling the same path through a shared submit helper; see Task 6 wiring.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui typecheck`
Expected: PASS. If `useExternalStoreRuntime` / `AppendMessage` / `ThreadMessageLike` import names differ in the installed `@assistant-ui/react`, check the package's exported types and adjust imports to the real names (do not guess).

- [ ] **Step 4: Commit**

```bash
git add examples/assistant-ui/frontend/acp/connection.ts examples/assistant-ui/frontend/acp/useAcpRuntime.ts
git commit -m "feat(examples/assistant-ui): add ACP connection and external-store runtime hook"
```

---

### Task 5: Tool UI components

**Files:**
- Create: `examples/assistant-ui/frontend/tools/FallbackToolUI.tsx`
- Create: `examples/assistant-ui/frontend/tools/ChartToolUI.tsx`
- Create: `examples/assistant-ui/frontend/tools/MediaToolUI.tsx`
- Create: `examples/assistant-ui/frontend/tools/FormToolUI.tsx`
- Create: `examples/assistant-ui/frontend/tools/index.ts`

**Interfaces:**
- Consumes: `makeAssistantToolUI` from `@assistant-ui/react`; `recharts`.
- Produces: `FallbackToolUI`, `ChartToolUI`, `MediaToolUI`, `FormToolUI` components, and a `SubmitContext` (React context) carrying `submit(text: string): void` so the form can send a follow-up prompt.

- [ ] **Step 1: Write `frontend/tools/FallbackToolUI.tsx`**

```tsx
import { makeAssistantToolUI } from "@assistant-ui/react";

export const FallbackToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: "*",
  render: ({ toolName, args, result, status }) => (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, margin: "6px 0", fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>
        {toolName} <span style={{ color: "#888", fontWeight: 400 }}>({status.type})</span>
      </div>
      <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{JSON.stringify(args, null, 2)}</pre>
      {result != null && (
        <pre style={{ margin: "4px 0 0", color: "#444", whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  ),
});
```

> Note: the `toolName: "*"` wildcard registers a fallback renderer for tool calls that have no specific UI. If the installed `@assistant-ui/react` does not support `"*"`, register the fallback via the documented fallback mechanism (check the package's ToolUI exports) instead of inventing one.

- [ ] **Step 2: Write `frontend/tools/ChartToolUI.tsx`**

```tsx
import { makeAssistantToolUI } from "@assistant-ui/react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

type ChartArgs = { title: string; kind: "line" | "bar"; data: { label: string; value: number }[] };

export const ChartToolUI = makeAssistantToolUI<ChartArgs, unknown>({
  toolName: "render_chart",
  render: ({ args }) => {
    const data = args?.data ?? [];
    return (
      <div style={{ margin: "8px 0" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{args?.title}</div>
        {args?.kind === "bar" ? (
          <BarChart width={360} height={200} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#0066cc" />
          </BarChart>
        ) : (
          <LineChart width={360} height={200} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Line dataKey="value" stroke="#0066cc" />
          </LineChart>
        )}
      </div>
    );
  },
});
```

- [ ] **Step 3: Write `frontend/tools/MediaToolUI.tsx`**

```tsx
import { makeAssistantToolUI } from "@assistant-ui/react";

type MediaArgs = { url: string; alt?: string };

export const MediaToolUI = makeAssistantToolUI<MediaArgs, unknown>({
  toolName: "show_media",
  render: ({ args }) =>
    args?.url ? (
      <img
        src={args.url}
        alt={args.alt ?? ""}
        style={{ maxWidth: 360, borderRadius: 6, margin: "8px 0", display: "block" }}
      />
    ) : null,
});
```

- [ ] **Step 4: Write `frontend/tools/FormToolUI.tsx`**

```tsx
import { createContext, useContext, useState } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";

export const SubmitContext = createContext<(text: string) => void>(() => {});

type FormField = { name: string; label: string; type?: string };
type FormArgs = { title: string; fields: FormField[] };

export const FormToolUI = makeAssistantToolUI<FormArgs, unknown>({
  toolName: "collect_form",
  render: ({ args }) => {
    const submit = useContext(SubmitContext);
    const [values, setValues] = useState<Record<string, string>>({});
    const [done, setDone] = useState(false);
    const fields = args?.fields ?? [];

    if (done) return <div style={{ color: "#2a7", margin: "8px 0" }}>Submitted.</div>;

    return (
      <form
        style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0", maxWidth: 360 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit(`Form "${args?.title}" submitted: ${JSON.stringify(values)}`);
          setDone(true);
        }}
      >
        <div style={{ fontWeight: 600 }}>{args?.title}</div>
        {fields.map((f) => (
          <label key={f.name} style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
            {f.label}
            <input
              type={f.type ?? "text"}
              value={values[f.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              style={{ padding: 4 }}
            />
          </label>
        ))}
        <button type="submit" style={{ padding: "4px 10px", alignSelf: "flex-start" }}>Submit</button>
      </form>
    );
  },
});
```

- [ ] **Step 5: Write `frontend/tools/index.ts`**

```typescript
export { FallbackToolUI } from "./FallbackToolUI";
export { ChartToolUI } from "./ChartToolUI";
export { MediaToolUI } from "./MediaToolUI";
export { FormToolUI, SubmitContext } from "./FormToolUI";
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui typecheck`
Expected: PASS. Confirm the `makeAssistantToolUI` render prop names (`args`, `result`, `status`) match the installed package; adjust if the real signature differs.

- [ ] **Step 7: Commit**

```bash
git add examples/assistant-ui/frontend/tools
git commit -m "feat(examples/assistant-ui): add chart/form/media/fallback tool UIs"
```

---

### Task 6: App wiring (frontend entry)

**Files:**
- Create: `examples/assistant-ui/frontend/App.tsx`
- Create: `examples/assistant-ui/frontend/main.tsx`

**Interfaces:**
- Consumes: `connectSession` (Task 4), `useAcpRuntime` (Task 4), tool UIs + `SubmitContext` (Task 5), `AssistantRuntimeProvider`, `Thread` from `@assistant-ui/react`, `Session` from `sandbox-agent`.
- The MCP server path inside the sandbox is the constant `MCP_SERVER_PATH = "/opt/mcp/sandbox-ui/mcp-server.cjs"` — must match the upload path used in Task 7.

- [ ] **Step 1: Write `frontend/App.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantRuntimeProvider, Thread } from "@assistant-ui/react";
import type { Session } from "sandbox-agent";
import { connectSession } from "./acp/connection";
import { useAcpRuntime } from "./acp/useAcpRuntime";
import { ChartToolUI, FallbackToolUI, FormToolUI, MediaToolUI, SubmitContext } from "./tools";

const MCP_SERVER_PATH = "/opt/mcp/sandbox-ui/mcp-server.cjs";
const SEED_PROMPT =
  "Demo the UI tools: call render_chart with a small bar chart of three months of sales, " +
  "then call show_media with any public image URL, then call collect_form asking for name and email.";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtime = useAcpRuntime(session);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    connectSession({
      baseUrl: `${window.location.origin}/proxy`,
      agent: (window as unknown as { __AGENT__?: string }).__AGENT__ ?? "claude",
      mcpServerPath: MCP_SERVER_PATH,
    })
      .then(setSession)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const submit = useCallback((text: string) => {
    sessionRef.current?.prompt([{ type: "text", text }]).catch(() => {});
  }, []);

  if (error) return <div style={{ padding: 16, color: "#c00" }}>Error: {error}</div>;
  if (!session) return <div style={{ padding: 16 }}>Connecting to sandbox...</div>;

  return (
    <SubmitContext.Provider value={submit}>
      <AssistantRuntimeProvider runtime={runtime}>
        <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: 8, borderBottom: "1px solid #eee" }}>
            <button onClick={() => submit(SEED_PROMPT)}>Run tool demo</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Thread />
          </div>
        </div>
        <ChartToolUI />
        <MediaToolUI />
        <FormToolUI />
        <FallbackToolUI />
      </AssistantRuntimeProvider>
    </SubmitContext.Provider>
  );
}
```

> Note: `Thread` is assistant-ui's prebuilt thread component. If the installed package exposes the thread under a different name/path (e.g. a styled `Thread` from a separate entry), import the actual exported component; do not invent one.

- [ ] **Step 2: Write `frontend/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Verify the frontend builds**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui build`
Expected: Vite build succeeds, emitting `dist/public`.

- [ ] **Step 4: Commit**

```bash
git add examples/assistant-ui/frontend/App.tsx examples/assistant-ui/frontend/main.tsx
git commit -m "feat(examples/assistant-ui): wire assistant-ui app with tool UIs"
```

---

### Task 7: Backend entry (start sandbox, upload MCP, serve + proxy)

**Files:**
- Create: `examples/assistant-ui/src/index.ts`

**Interfaces:**
- Consumes: `startDockerSandbox` from `@sandbox-agent/example-shared/docker`; `SandboxAgent` from `sandbox-agent`; `@hono/node-server`, `hono`.
- Uploads the MCP bundle to `MCP_SERVER_PATH = "/opt/mcp/sandbox-ui/mcp-server.cjs"` (must match Task 6).
- Serves `dist/public` and proxies everything under `/proxy/*` to the sandbox base URL.

- [ ] **Step 1: Write `src/index.ts`**

```typescript
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { SandboxAgent } from "sandbox-agent";
import { startDockerSandbox } from "@sandbox-agent/example-shared/docker";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../dist/public");
const MCP_BUNDLE = path.resolve(__dirname, "../dist/mcp-server.cjs");
const MCP_SERVER_PATH = "/opt/mcp/sandbox-ui/mcp-server.cjs";
const UI_PORT = 3010;

if (!fs.existsSync(MCP_BUNDLE)) {
  console.error("Missing dist/mcp-server.cjs. Run `pnpm build:mcp` first.");
  process.exit(1);
}
if (!fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  console.error("Missing dist/public. Run `pnpm build` first.");
  process.exit(1);
}

console.log("Starting sandbox...");
const { baseUrl, cleanup } = await startDockerSandbox({ port: 3011 });

console.log("Uploading MCP server bundle...");
const client = await SandboxAgent.connect({ baseUrl });
const bundle = await fs.promises.readFile(MCP_BUNDLE);
await client.writeFsFile({ path: MCP_SERVER_PATH }, bundle);

const app = new Hono();

// Reverse-proxy everything under /proxy/* to the sandbox (endpoint-path agnostic).
app.all("/proxy/*", async (c) => {
  const rest = c.req.path.slice("/proxy".length) || "/";
  const target = `${baseUrl}${rest}${new URL(c.req.url).search}`;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  const res = await fetch(target, {
    method: c.req.method,
    headers,
    body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : c.req.raw.body,
    // @ts-expect-error Node fetch streaming requires duplex for request bodies.
    duplex: "half",
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

// Serve the built frontend.
app.get("*", async (c) => {
  const rel = c.req.path === "/" ? "/index.html" : c.req.path;
  const file = path.join(PUBLIC_DIR, rel);
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(PUBLIC_DIR, "index.html");
  const body = await fs.promises.readFile(target);
  const type = target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/html";
  return new Response(body, { headers: { "content-type": type } });
});

serve({ fetch: app.fetch, port: UI_PORT });
console.log(`\n  Open: http://localhost:${UI_PORT}\n  Click "Run tool demo" to see chart/form/media render.\n  Ctrl+C to stop.`);

process.on("SIGINT", () => {
  cleanup().then(() => process.exit(0));
});
```

> Note: the proxy passes SSE through because Node `fetch` returns a streaming `res.body`. If `client.writeFsFile` signature differs (e.g. positional vs object path), grep `sdks/typescript/src/client.ts` for the current signature — the `examples/mcp-custom-tool` form `writeFsFile({ path }, bundle)` is the reference.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add examples/assistant-ui/src/index.ts
git commit -m "feat(examples/assistant-ui): add backend entry (start sandbox, upload MCP, serve + proxy)"
```

---

### Task 8: README + end-to-end verification

**Files:**
- Create: `examples/assistant-ui/README.md`

**Interfaces:**
- Consumes: everything above. This task verifies the whole example end-to-end and documents how to run it.

- [ ] **Step 1: Write `README.md`**

```markdown
# assistant-ui + Sandbox Agent

A minimal example wiring the [assistant-ui](https://github.com/assistant-ui/assistant-ui) React chat UI to a Sandbox Agent backend over the `sandbox-agent` TypeScript SDK. Tool calls render as rich components: charts, forms, images, and a generic fallback.

## How it works

1. `src/index.ts` starts a Docker sandbox, uploads a bundled MCP server, and serves the built UI while proxying `/proxy/*` to the sandbox.
2. The browser connects with `SandboxAgent.connect`, creates a session that loads the MCP server, and streams events into assistant-ui via an `ExternalStoreRuntime`.
3. A real agent (claude) calls the MCP tools `render_chart`, `collect_form`, `show_media`; each maps to a `makeAssistantToolUI` component. Forms send the collected values back as a follow-up prompt.

## Run

You need agent credentials in your environment (for example `ANTHROPIC_API_KEY`) and Docker running.

\`\`\`bash
pnpm install
ANTHROPIC_API_KEY=sk-... pnpm --filter @sandbox-agent/example-assistant-ui start
\`\`\`

Open http://localhost:3010 and click "Run tool demo".
```

- [ ] **Step 2: Run the unit tests**

Run: `pnpm --filter @sandbox-agent/example-assistant-ui test`
Expected: PASS (tools + reducer suites).

- [ ] **Step 3: End-to-end manual verification**

Run: `ANTHROPIC_API_KEY=... pnpm --filter @sandbox-agent/example-assistant-ui start`
Then open http://localhost:3010 and click "Run tool demo". Verify:
- assistant text streams in
- a bar chart renders (render_chart)
- an image renders (show_media)
- a form renders; submitting it posts a follow-up prompt and the agent responds (collect_form)
- any other tool call shows the fallback card

In the browser devtools, log one `tool_call` event and confirm `update.title` normalizes to `render_chart`/`collect_form`/`show_media` via `normalizeToolName`. If the emitted title uses a different separator than handled, extend `normalizeToolName` and its test.

- [ ] **Step 4: Final commit**

```bash
git add examples/assistant-ui/README.md
git commit -m "docs(examples/assistant-ui): add README and verify end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Runnable example under `examples/assistant-ui/` — Tasks 1, 7, 8.
- assistant-ui `ExternalStoreRuntime` bridge — Task 4.
- Pure, tested event reducer — Task 3.
- Four tool UIs (chart/form/media/fallback) — Task 5.
- Form round-trip via follow-up prompt — Tasks 5 + 6 (`SubmitContext` → `session.prompt`).
- Real agent + MCP tools driver — Tasks 2 (MCP server) + 7 (upload/session wiring).
- Hono serve + catch-all proxy — Task 7.
- Testing (reducer + tool handlers, typecheck, manual) — Tasks 2, 3, 8.
- Deferred elicitation — out of scope by design; not implemented (recorded in spec).

**Placeholder scan:** No TBD/TODO. Where an external API name could not be 100% verified (`getHealth`, `writeFsFile` arg shape, `makeAssistantToolUI` prop names, `Thread`/`useExternalStoreRuntime` exports, `"*"` fallback), the step gives the verified reference example and an explicit instruction to grep the real signature rather than guess. These are integration-point checks, not unfilled blanks.

**Type consistency:** `MCP_SERVER_PATH` is identical in Tasks 6 and 7 (`/opt/mcp/sandbox-ui/mcp-server.cjs`). MCP server name `sandboxUi` is consistent (Task 2 server, Task 4 sessionInit, normalization tests). Reducer exports (`initialState`, `reduce`, `normalizeToolName`, `ReducerState`) match their usage in Tasks 3 and 4. Tool names (`render_chart`/`collect_form`/`show_media`) match across Tasks 2, 3, 5.

## Known integration risks (verify during execution, do not guess)

1. `@assistant-ui/react` API surface (`useExternalStoreRuntime`, `makeAssistantToolUI` render props, `Thread`, `"*"` fallback) — pin the installed version and adjust import/prop names to match its actual exports.
2. The exact `tool_call.title` string the backend emits for MCP tools — confirm in Task 8 and extend `normalizeToolName` if needed.
3. `sandbox-agent` SDK method names (`getHealth`, `writeFsFile` arg shape) — grep `sdks/typescript/src/client.ts`; `examples/mcp-custom-tool` is the current-API reference.
4. Running `SandboxAgent.connect` in the browser relies on fetch+SSE; the catch-all proxy must stream SSE (verified via Node `fetch` body passthrough).
```
