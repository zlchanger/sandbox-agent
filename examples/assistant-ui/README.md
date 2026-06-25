# assistant-ui + Sandbox Agent

A minimal example wiring the [assistant-ui](https://github.com/assistant-ui/assistant-ui) React chat UI to a Sandbox Agent backend over the `sandbox-agent` TypeScript SDK. Tool calls render as rich components: charts, forms, images, and a generic fallback.

## How it works

1. `src/index.ts` starts a Docker sandbox, uploads a bundled MCP server, and serves the built UI while proxying `/proxy/*` to the sandbox.
2. The browser connects with `SandboxAgent.connect`, creates a session that loads the MCP server, and streams events into assistant-ui via an `ExternalStoreRuntime`.
3. A real agent (claude) calls the MCP tools `render_chart`, `collect_form`, `show_media`; each maps to a `makeAssistantToolUI` component. Forms send the collected values back as a follow-up prompt.

## Run

You need agent credentials in your environment (for example `ANTHROPIC_API_KEY`) and Docker running.

```bash
pnpm install
ANTHROPIC_API_KEY=sk-... pnpm --filter @sandbox-agent/example-assistant-ui start
```

Open http://localhost:3010 and click "Run tool demo".
