import { z } from "zod";

export const chartInputShape = {
  title: z.string().describe("Chart title"),
  kind: z.enum(["line", "bar"]).describe("Chart type"),
  data: z.array(z.object({ label: z.string(), value: z.number() })).describe("Data points to plot"),
};

export const formInputShape = {
  title: z.string().describe("Form title"),
  fields: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(["text", "number", "email"]).default("text"),
      }),
    )
    .describe("Fields the user should fill in"),
};

export const mediaInputShape = {
  url: z.string().describe("Image or media URL to display"),
  alt: z.string().default("").describe("Alt text"),
};

type ChartArgs = { title: string; kind: "line" | "bar"; data: { label: string; value: number }[] };
type FormArgs = { title: string; fields: { name: string; label: string; type?: string }[] };
type MediaArgs = { url: string; alt?: string };

type ToolResult = { content: { type: "text"; text: string }[] };

export function handleChart(args: ChartArgs): ToolResult {
  return { content: [{ type: "text", text: `Rendered chart "${args.title}" with ${args.data.length} points.` }] };
}

export function handleForm(args: FormArgs): ToolResult {
  return { content: [{ type: "text", text: `Presented form "${args.title}" with ${args.fields.length} fields. Awaiting user input.` }] };
}

export function handleMedia(args: MediaArgs): ToolResult {
  return { content: [{ type: "text", text: `Displayed media: ${args.url}` }] };
}
