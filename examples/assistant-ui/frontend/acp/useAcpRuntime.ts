import { useEffect, useRef, useState } from "react";
import { useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from "@assistant-ui/react";
import type { Session } from "sandbox-agent";
import { initialState, reduce, type ReducerState } from "./eventReducer";

function appendMessageText(message: AppendMessage): string {
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function useAcpRuntime(session: Session | null) {
  const [state, setState] = useState<ReducerState>(initialState);
  const [isRunning, setIsRunning] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    if (!session) return;
    // Auto-approve permission requests so the demo flows without a permission UI.
    const offPerm = session.onPermissionRequest((req) => {
      session.respondPermission(req.id, "once").catch(() => {});
    });
    const offEvent = session.onEvent((event) => {
      setState((prev) => reduce(prev, event));
    });
    return () => {
      offPerm();
      offEvent();
    };
  }, [session]);

  const messages: ThreadMessageLike[] = state.messages;

  return useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async (message: AppendMessage) => {
      const s = sessionRef.current;
      if (!s) return;
      const text = appendMessageText(message);
      if (!text) return;
      setIsRunning(true);
      try {
        await s.prompt([{ type: "text", text }]);
      } finally {
        setIsRunning(false);
      }
    },
  });
}
