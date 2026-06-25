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
  const respHeaders = new Headers(res.headers);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  return new Response(res.body, { status: res.status, headers: respHeaders });
});

// Serve the built frontend.
app.get("*", async (c) => {
  const rel = c.req.path === "/" ? "/index.html" : c.req.path;
  const file = path.join(PUBLIC_DIR, rel);

  // Path traversal guard: ensure file is contained within PUBLIC_DIR
  const isContained = file === PUBLIC_DIR || file.startsWith(PUBLIC_DIR + path.sep);

  const target = isContained && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(PUBLIC_DIR, "index.html");
  const body = await fs.promises.readFile(target);

  // Extended content-type map for common Vite assets
  const contentTypeMap: Record<string, string> = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
  };

  const ext = path.extname(target);
  const type = contentTypeMap[ext] || "text/html";

  return new Response(body, { headers: { "content-type": type } });
});

serve({ fetch: app.fetch, port: UI_PORT });
console.log(`\n  Open: http://localhost:${UI_PORT}\n  Click "Run tool demo" to see chart/form/media render.\n  Ctrl+C to stop.`);

process.on("SIGINT", () => {
  cleanup()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
