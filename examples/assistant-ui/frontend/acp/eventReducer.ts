import type { ThreadMessageLike } from "@assistant-ui/react";
import type { SessionEvent } from "sandbox-agent";

export type ReducerState = { messages: ThreadMessageLike[] };
export const initialState: ReducerState = { messages: [] };

type Raw = Record<string, unknown>;
type Part = { type: "text"; text: string } | { type: "reasoning"; text: string } | ToolCallPart;
type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
};

/** MCP tools may surface as `mcp__server__tool`, `server/tool`, or `server.tool`. Keep the final segment. */
export function normalizeToolName(raw: string): string {
  let name = raw;
  if (name.includes("__")) name = name.slice(name.lastIndexOf("__") + 2);
  if (name.includes("/")) name = name.slice(name.lastIndexOf("/") + 1);
  if (name.includes(".")) name = name.slice(name.lastIndexOf(".") + 1);
  return name;
}

function asText(content: unknown): string {
  const c = content as Raw | undefined;
  if (c && c.type === "text" && typeof c.text === "string") return c.text;
  return "";
}

function cloneMessages(state: ReducerState): ThreadMessageLike[] {
  return state.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...(m.content as Part[])] : m.content }));
}

function ensureAssistant(messages: ThreadMessageLike[]): ThreadMessageLike {
  const last = messages.at(-1);
  if (last && last.role === "assistant" && Array.isArray(last.content)) return last;
  const created: ThreadMessageLike = { role: "assistant", content: [] };
  messages.push(created);
  return created;
}

function appendText(state: ReducerState, text: string, kind: "text" | "reasoning"): ReducerState {
  if (!text) return state;
  const messages = cloneMessages(state);
  const msg = ensureAssistant(messages);
  const parts = msg.content as Part[];
  const last = parts.at(-1);
  if (last && last.type === kind) {
    parts[parts.length - 1] = { type: kind, text: last.text + text } as Part;
  } else {
    parts.push({ type: kind, text } as Part);
  }
  return { messages };
}

function addToolCall(state: ReducerState, update: Raw): ReducerState {
  const messages = cloneMessages(state);
  const msg = ensureAssistant(messages);
  const parts = msg.content as Part[];
  parts.push({
    type: "tool-call",
    toolCallId: String(update.toolCallId ?? ""),
    toolName: normalizeToolName(String(update.title ?? "")),
    args: update.rawInput ?? {},
  });
  return { messages };
}

function updateToolCall(state: ReducerState, update: Raw): ReducerState {
  const id = String(update.toolCallId ?? "");
  const messages = cloneMessages(state);
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    const parts = msg.content as Part[];
    const idx = parts.findIndex((p) => p.type === "tool-call" && p.toolCallId === id);
    if (idx >= 0) {
      const existing = parts[idx] as ToolCallPart;
      parts[idx] = {
        ...existing,
        result: "rawOutput" in update ? update.rawOutput : existing.result,
      };
      break;
    }
  }
  return { messages };
}

export function reduce(state: ReducerState, event: SessionEvent): ReducerState {
  const payload = (event.payload ?? {}) as Raw;
  const method = typeof payload.method === "string" ? payload.method : null;
  const params = (payload.params ?? {}) as Raw;

  if (event.sender === "client" && method === "session/prompt") {
    const prompt = params.prompt;
    const text = Array.isArray(prompt) ? prompt.map((p) => asText(p)).join("") : typeof prompt === "string" ? prompt : "";
    if (!text) return state;
    return { messages: [...state.messages, { role: "user", content: [{ type: "text", text }] }] };
  }

  if (method === "session/update") {
    const update = (params.update ?? {}) as Raw;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return appendText(state, asText(update.content), "text");
      case "agent_thought_chunk":
        return appendText(state, asText(update.content), "reasoning");
      case "tool_call":
        return addToolCall(state, update);
      case "tool_call_update":
        return updateToolCall(state, update);
      default:
        return state;
    }
  }
  return state;
}
