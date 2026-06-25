import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const FallbackToolUI: ToolCallMessagePartComponent = ({ toolName, args, result, status }) => (
  <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, margin: "6px 0", fontSize: 13 }}>
    <div style={{ fontWeight: 600 }}>
      {toolName} <span style={{ color: "#888", fontWeight: 400 }}>({status?.type})</span>
    </div>
    <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{JSON.stringify(args, null, 2)}</pre>
    {result != null && <pre style={{ margin: "4px 0 0", color: "#444", whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>}
  </div>
);
