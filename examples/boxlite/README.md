# BoxLite Sandbox Agent Example

Run sandbox-agent inside a [BoxLite](https://boxlite.ai) micro-VM. BoxLite boots
lightweight, hardware-isolated boxes (each with its own kernel) without
operating heavyweight VM infrastructure.

This example has two entry points:

| Command                              | Style    | What it shows                                                        |
| ------------------------------------ | -------- | ------------------------------------------------------------------- |
| `pnpm start`                         | manual   | Boot a box, start the server with `box.exec`, then `connect()`.     |
| `pnpm start:provider`                | provider | Drive BoxLite through a `SandboxProvider` with `SandboxAgent.start`. |

The provider version (`src/provider.ts`) implements the `SandboxProvider`
interface so the SDK manages the box lifecycle: `create`, `getUrl`,
`ensureServer`, and `destroy`.

## Prerequisites

- A host that can run BoxLite: Linux (KVM), macOS (Apple Silicon), or Windows
  (WSL2).
- Docker, to build the OCI image (see `setup-image.ts`).
- An API key for your agent (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).

## Run

```sh
export ANTHROPIC_API_KEY=sk-...   # or OPENAI_API_KEY
pnpm -C examples/boxlite start:provider
```

## Limitation: no pause/resume via checkpoint

BoxLite supports fork/checkpoint/restore at the platform (Rust) level, but the
`@boxlite-ai/boxlite` Node SDK currently exposes only `getId`, `getInfo`,
`exec`, and `stop`. The provider therefore does not implement `pause`/
`reconnect` (memory snapshot/restore).

To resume a session whose box was torn down, rely on sandbox-agent's session
restoration (replay persisted events via a `SessionPersistDriver`) plus
re-mounting data, rather than a memory snapshot. See the project docs on
session persistence and restoration.
