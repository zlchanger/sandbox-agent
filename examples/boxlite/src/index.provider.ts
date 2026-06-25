import { detectAgent } from "@sandbox-agent/example-shared";
import { SandboxAgent } from "sandbox-agent";
import { boxlite } from "./provider.ts";
import { OCI_DIR, setupImage } from "./setup-image.ts";

// Provider-style BoxLite demo: instead of manually starting the server and
// calling connect() (see index.ts), this drives BoxLite through a
// SandboxProvider, so the SDK manages create/getUrl/ensureServer/destroy.

const env: Record<string, string> = {};
if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;

setupImage();

const client = await SandboxAgent.start({
  sandbox: boxlite({ rootfsPath: OCI_DIR, env }),
});

console.log(`UI: ${client.inspectorUrl}`);

const session = await client.createSession({
  agent: detectAgent(),
  cwd: "/root",
});

session.onEvent((event) => {
  console.log(`[${event.sender}]`, JSON.stringify(event.payload));
});

session.prompt([{ type: "text", text: "Say hello from a BoxLite micro-VM in one sentence." }]);

process.once("SIGINT", async () => {
  await client.destroySandbox();
  process.exit(0);
});
