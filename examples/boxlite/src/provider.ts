import { SimpleBox } from "@boxlite-ai/boxlite";
import type { SandboxProvider } from "sandbox-agent";

// Port sandbox-agent listens on inside the box.
const DEFAULT_GUEST_PORT = 3000;
// Working directory for sessions inside the box.
const DEFAULT_CWD = "/root";

export interface BoxliteProviderOptions {
  /** OCI image directory (see setup-image.ts), passed to SimpleBox as rootfsPath. */
  rootfsPath: string;
  /** Port sandbox-agent listens on inside the box. */
  agentPort?: number;
  /** Base host port. Each box maps to basePort, basePort+1, ... */
  basePort?: number;
  /** Working directory for sessions. */
  cwd?: string;
  /** Env vars injected into the box. */
  env?: Record<string, string>;
  /** Disk size for the box, in GiB. */
  diskSizeGb?: number;
}

interface BoxEntry {
  box: SimpleBox;
  hostPort: number;
}

// Mirrors sandbox-agent's internal server-start helper. The duplicate process
// exits immediately on port conflict, so calling this repeatedly is safe.
function serverStartCommand(port: number): string {
  return `nohup sandbox-agent server --no-token --host 0.0.0.0 --port ${port} >/tmp/sandbox-agent.log 2>&1 &`;
}

/**
 * A sandbox-agent provider backed by BoxLite micro-VMs.
 *
 * Each call to `create` boots a SimpleBox from the given OCI image, starts the
 * sandbox-agent server inside it, and maps its port to the host. Boxes are kept
 * in a local registry keyed by their BoxLite id.
 *
 * NOTE on pause/resume: BoxLite supports fork/checkpoint/restore at the
 * platform (Rust) level, but the @boxlite-ai/boxlite Node SDK does not expose
 * those methods (only getId/getInfo/exec/stop). So `pause`/`reconnect` are not
 * implemented here. To resume a session whose box was torn down, rely on
 * sandbox-agent's session restoration (replay persisted events) plus
 * re-mounting tenant data, rather than a memory snapshot.
 */
export function boxlite(options: BoxliteProviderOptions): SandboxProvider {
  const agentPort = options.agentPort ?? DEFAULT_GUEST_PORT;
  const cwd = options.cwd ?? DEFAULT_CWD;
  let nextPort = options.basePort ?? DEFAULT_GUEST_PORT;
  const boxes = new Map<string, BoxEntry>();

  async function startServer(box: SimpleBox): Promise<void> {
    const result = await box.exec("sh", "-c", serverStartCommand(agentPort));
    if (result.exitCode !== 0) {
      throw new Error(`failed to start sandbox-agent server: ${result.stderr}`);
    }
  }

  return {
    name: "boxlite",
    defaultCwd: cwd,

    async create(): Promise<string> {
      const hostPort = nextPort++;
      const box = new SimpleBox({
        rootfsPath: options.rootfsPath,
        env: options.env ?? {},
        ports: [{ hostPort, guestPort: agentPort }],
        diskSizeGb: options.diskSizeGb ?? 4,
      });
      await startServer(box);
      const id = await box.getId();
      boxes.set(id, { box, hostPort });
      return id;
    },

    async getUrl(sandboxId: string): Promise<string> {
      const entry = boxes.get(sandboxId);
      if (!entry) throw new Error(`boxlite box not found: ${sandboxId}`);
      return `http://127.0.0.1:${entry.hostPort}`;
    },

    async ensureServer(sandboxId: string): Promise<void> {
      const entry = boxes.get(sandboxId);
      if (!entry) return;
      await entry.box.exec("sh", "-c", serverStartCommand(agentPort)).catch(() => {});
    },

    async destroy(sandboxId: string): Promise<void> {
      const entry = boxes.get(sandboxId);
      if (!entry) return;
      await entry.box.stop();
      boxes.delete(sandboxId);
    },
  };
}
