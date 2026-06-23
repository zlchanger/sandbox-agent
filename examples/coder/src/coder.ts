import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import type { SandboxProvider } from "sandbox-agent";

const execFileAsync = promisify(execFile);

// Port sandbox-agent listens on inside the Coder workspace.
const DEFAULT_AGENT_PORT = 2468;
// Working directory for sessions inside the workspace.
const DEFAULT_CWD = "/home/coder";

export interface CoderProviderOptions {
  /** Coder template name used to create the workspace. */
  template: string;
  /** Port sandbox-agent listens on inside the workspace. */
  agentPort?: number;
  /** Local port used for `coder port-forward`. Defaults to `agentPort`. */
  localPort?: number;
  /** Working directory for sessions inside the workspace. */
  cwd?: string;
  /** Extra `--parameter key=value` pairs passed to `coder create`. */
  parameters?: Record<string, string>;
  /** Path to the coder CLI. Defaults to "coder" on PATH. */
  coderBin?: string;
}

// Mirrors sandbox-agent's internal server-start helper. The duplicate process
// exits immediately on port conflict, so calling this repeatedly is safe.
function serverStartCommand(port: number): string {
  return `nohup sandbox-agent server --no-token --host 0.0.0.0 --port ${port} >/tmp/sandbox-agent.log 2>&1 &`;
}

// Poll a local TCP port until it accepts connections.
function waitForPort(port: number, host = "127.0.0.1", timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(attempt, 500);
        }
      });
    };
    attempt();
  });
}

/**
 * A sandbox-agent provider backed by Coder workspaces, driven through the
 * `coder` CLI. Each workspace is an isolated sandbox: `create` provisions one
 * from a template, `getUrl` exposes the in-workspace sandbox-agent over a local
 * port-forward, and `destroy` tears the workspace down.
 *
 * Requires the `coder` CLI to be installed and logged in (`coder login`).
 */
export function coder(options: CoderProviderOptions): SandboxProvider {
  const agentPort = options.agentPort ?? DEFAULT_AGENT_PORT;
  const localPort = options.localPort ?? agentPort;
  const cwd = options.cwd ?? DEFAULT_CWD;
  const bin = options.coderBin ?? "coder";
  // Active `coder port-forward` processes, keyed by workspace name.
  const forwards = new Map<string, ChildProcess>();

  async function cli(args: string[], timeoutMs?: number): Promise<string> {
    const { stdout } = await execFileAsync(bin, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return stdout;
  }

  // Best-effort: ensure the server is running. The template's startup script
  // normally starts it already, so failures here are non-fatal.
  async function ensureServer(sandboxId: string): Promise<void> {
    await cli(["ssh", sandboxId, "--", serverStartCommand(agentPort)], 20_000).catch(() => {});
  }

  return {
    name: "coder",
    defaultCwd: cwd,

    async create(): Promise<string> {
      const name = `sbx-${Date.now().toString(36)}`;
      const args = ["create", name, "--template", options.template, "--yes"];
      for (const [key, value] of Object.entries(options.parameters ?? {})) {
        args.push("--parameter", `${key}=${value}`);
      }
      // `coder create` blocks until the build completes.
      await cli(args);
      await ensureServer(name);
      return name;
    },

    ensureServer,

    async getUrl(sandboxId: string): Promise<string> {
      if (!forwards.has(sandboxId)) {
        const child = spawn(bin, ["port-forward", sandboxId, "--tcp", `${localPort}:${agentPort}`], {
          stdio: "ignore",
        });
        forwards.set(sandboxId, child);
        await waitForPort(localPort);
      }
      return `http://127.0.0.1:${localPort}`;
    },

    async destroy(sandboxId: string): Promise<void> {
      const child = forwards.get(sandboxId);
      if (child) {
        child.kill();
        forwards.delete(sandboxId);
      }
      await cli(["delete", sandboxId, "--yes"]).catch(() => {});
    },
  };
}
