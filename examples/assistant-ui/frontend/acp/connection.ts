import { SandboxAgent, type Session } from "sandbox-agent";

export async function connectSession(opts: { baseUrl: string; agent: string; mcpServerPath: string }): Promise<Session> {
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
      mcpServers: [{ name: "sandboxUi", command: "node", args: [opts.mcpServerPath], env: [] }],
    },
  });
}
