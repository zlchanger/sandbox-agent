import { makeAssistantToolUI } from "@assistant-ui/react";

type MediaArgs = { url: string; alt?: string };

export const MediaToolUI = makeAssistantToolUI<MediaArgs, unknown>({
  toolName: "show_media",
  display: "standalone",
  render: ({ args }) =>
    args?.url ? <img src={args.url} alt={args.alt ?? ""} style={{ maxWidth: 360, borderRadius: 6, margin: "8px 0", display: "block" }} /> : null,
});
