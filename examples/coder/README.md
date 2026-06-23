# Coder Sandbox Agent Example

Run sandbox-agent inside a [Coder](https://coder.com) workspace. Each workspace
is an isolated sandbox; this example treats Coder as the sandbox provider.

This is useful when you already self-host Coder and want its per-workspace
isolation, RBAC, and app proxy in front of agent sessions, instead of a managed
sandbox API.

> [!NOTE]
> Unlike the managed-provider examples (E2B, Daytona, ...), Coder is a platform
> you operate. You need a running Coder deployment, the `coder` CLI, and a
> template. This example was not executed in CI; treat the Terraform template as
> a starting point that may need tweaks for your Coder version.

## How it works

- `src/coder.ts` implements a `SandboxProvider` driven by the `coder` CLI:
  - `create` runs `coder create` to provision a workspace from a template.
  - `getUrl` runs `coder port-forward` to expose the in-workspace
    sandbox-agent server on a local port, which the SDK connects to.
  - `ensureServer` runs `coder ssh -- "sandbox-agent server ..."` as a
    fallback if the server is not already running.
  - `destroy` kills the port-forward and runs `coder delete`.
- `template/main.tf` is a Docker template that uses the
  `rivetdev/sandbox-agent:*-full` image (which bundles the sandbox-agent binary
  and coding agents), starts the server on boot, and exposes the Inspector as a
  `coder_app`.

## Prerequisites

- A running Coder deployment.
- The `coder` CLI installed and logged in (`coder login <url>`).
- Docker available to Coder (for the provided template).
- An API key for your agent (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).

## Setup

1. Push the template to your Coder deployment:

   ```sh
   cd template
   coder templates push sandbox-agent -d .
   ```

2. From the repo root, install dependencies and run the example:

   ```sh
   export CODER_TEMPLATE=sandbox-agent
   export ANTHROPIC_API_KEY=sk-...   # or OPENAI_API_KEY
   pnpm -C examples/coder start
   ```

The example provisions a workspace, connects to the sandbox-agent inside it,
prints the Inspector URL, and sends one prompt. Press Ctrl+C to tear the
workspace down.

## Notes

- The API keys are forwarded into the workspace as template `--parameter`
  values (see `src/index.ts` and `template/main.tf`).
- Two workspaces are isolated from each other even though both serve
  sandbox-agent on port 2468 internally; isolation is per workspace, not per
  port.
- For the design rationale behind using Coder vs. a lighter runtime, see
  `specs/2026-06-23-multitenant-agent-platform-design.md`.
