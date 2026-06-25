import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantRuntimeProvider, ThreadPrimitive, MessagePrimitive, ComposerPrimitive } from "@assistant-ui/react";
import type { Session } from "sandbox-agent";
import { connectSession } from "./acp/connection";
import { useAcpRuntime } from "./acp/useAcpRuntime";
import { ChartToolUI, FallbackToolUI, FormToolUI, MediaToolUI, SubmitContext } from "./tools";

const MCP_SERVER_PATH = "/opt/mcp/sandbox-ui/mcp-server.cjs";
const SEED_PROMPT =
  "Demo the UI tools: call render_chart with a small bar chart of three months of sales, " +
  "then call show_media with any public image URL, then call collect_form asking for name and email.";

function UserMessage() {
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "80%", margin: "4px 0", background: "#0066cc", color: "#fff", padding: "6px 10px", borderRadius: 8 }}>
      <MessagePrimitive.Parts />
    </div>
  );
}

function AssistantMessage() {
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "80%", margin: "4px 0" }}>
      <MessagePrimitive.Parts components={{ tools: { Fallback: FallbackToolUI } }} />
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtime = useAcpRuntime(session);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    connectSession({
      baseUrl: `${window.location.origin}/proxy`,
      agent: (window as unknown as { __AGENT__?: string }).__AGENT__ ?? "claude",
      mcpServerPath: MCP_SERVER_PATH,
    })
      .then(setSession)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const submit = useCallback((text: string) => {
    sessionRef.current?.prompt([{ type: "text", text }]).catch(() => {});
  }, []);

  if (error) return <div style={{ padding: 16, color: "#c00" }}>Error: {error}</div>;
  if (!session) return <div style={{ padding: 16 }}>Connecting to sandbox...</div>;

  return (
    <SubmitContext.Provider value={submit}>
      <AssistantRuntimeProvider runtime={runtime}>
        {/* Mounting these registers their tool renderers; they render nothing themselves. */}
        <ChartToolUI />
        <MediaToolUI />
        <FormToolUI />
        <ThreadPrimitive.Root style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: 8, borderBottom: "1px solid #eee" }}>
            <button onClick={() => submit(SEED_PROMPT)}>Run tool demo</button>
          </div>
          <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: 12 }}>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root style={{ display: "flex", gap: 8, padding: 8, borderTop: "1px solid #eee" }}>
            <ComposerPrimitive.Input style={{ flex: 1, padding: 6 }} placeholder="Message..." />
            <ComposerPrimitive.Send style={{ padding: "6px 12px" }}>Send</ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </SubmitContext.Provider>
  );
}
