import { detectAgent } from "@sandbox-agent/example-shared";
import { SandboxAgent } from "sandbox-agent";
import { coder } from "./coder.ts";

const template = process.env.CODER_TEMPLATE;
if (!template) {
  console.error("Set CODER_TEMPLATE to the Coder template name (see template/main.tf).");
  process.exit(1);
}

// Forward API keys into the workspace as template parameters so the coding
// agent inside can authenticate. The template declares matching parameters.
const parameters: Record<string, string> = {};
if (process.env.ANTHROPIC_API_KEY) parameters.anthropic_api_key = process.env.ANTHROPIC_API_KEY;
if (process.env.OPENAI_API_KEY) parameters.openai_api_key = process.env.OPENAI_API_KEY;

const client = await SandboxAgent.start({
  sandbox: coder({ template, parameters }),
});

console.log(`UI: ${client.inspectorUrl}`);

const session = await client.createSession({
  agent: detectAgent(),
});

session.onEvent((event) => {
  console.log(`[${event.sender}]`, JSON.stringify(event.payload));
});

session.prompt([{ type: "text", text: "Say hello from a Coder workspace in one sentence." }]);

process.once("SIGINT", async () => {
  await client.destroySandbox();
  process.exit(0);
});
