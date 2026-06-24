import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chartInputShape, formInputShape, mediaInputShape, handleChart, handleForm, handleMedia } from "./tools";

async function main() {
  const server = new McpServer({ name: "sandboxUi", version: "1.0.0" });

  server.tool("render_chart", "Render a line or bar chart in the UI. Pass the data to plot.", chartInputShape, async (args) => handleChart(args as never));
  server.tool("collect_form", "Show a form in the UI to collect input from the user.", formInputShape, async (args) => handleForm(args as never));
  server.tool("show_media", "Display an image or media URL in the UI.", mediaInputShape, async (args) => handleMedia(args as never));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
