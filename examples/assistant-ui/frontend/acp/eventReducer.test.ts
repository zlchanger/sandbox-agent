import { describe, it, expect } from "vitest";
import { initialState, reduce, normalizeToolName, type ReducerState } from "./eventReducer";
import type { SessionEvent } from "sandbox-agent";

function ev(partial: Partial<SessionEvent> & { payload: unknown }): SessionEvent {
  return {
    id: Math.random().toString(36).slice(2),
    eventIndex: 0,
    sessionId: "s1",
    createdAt: 0,
    connectionId: "c1",
    sender: "agent",
    ...partial,
  } as SessionEvent;
}

describe("normalizeToolName", () => {
  it("keeps a plain snake_case name", () => {
    expect(normalizeToolName("render_chart")).toBe("render_chart");
  });
  it("strips an mcp namespace prefix", () => {
    expect(normalizeToolName("mcp__sandboxUi__render_chart")).toBe("render_chart");
  });
  it("strips a slash/dot prefix", () => {
    expect(normalizeToolName("sandboxUi/show_media")).toBe("show_media");
    expect(normalizeToolName("sandboxUi.show_media")).toBe("show_media");
  });
});

describe("reduce", () => {
  it("adds a user message from session/prompt", () => {
    const s = reduce(
      initialState,
      ev({
        sender: "client",
        payload: { method: "session/prompt", params: { prompt: [{ type: "text", text: "hi" }] } },
      }),
    );
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("user");
    expect(s.messages[0].content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("accumulates assistant message chunks into one message", () => {
    let s: ReducerState = initialState;
    s = reduce(
      s,
      ev({ payload: { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } } } } }),
    );
    s = reduce(
      s,
      ev({ payload: { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } } } } }),
    );
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("assistant");
    expect(s.messages[0].content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("adds a tool-call part with normalized name and merges its update", () => {
    let s: ReducerState = initialState;
    s = reduce(
      s,
      ev({
        payload: {
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "t1",
              title: "mcp__sandboxUi__render_chart",
              status: "pending",
              rawInput: { title: "X", kind: "bar", data: [] },
            },
          },
        },
      }),
    );
    s = reduce(
      s,
      ev({
        payload: {
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "t1",
              status: "completed",
              rawOutput: { ok: true },
            },
          },
        },
      }),
    );
    const part = (s.messages.at(-1)!.content as any[]).find((p) => p.type === "tool-call");
    expect(part.toolName).toBe("render_chart");
    expect(part.toolCallId).toBe("t1");
    expect(part.args).toEqual({ title: "X", kind: "bar", data: [] });
    expect(part.result).toEqual({ ok: true });
  });
});
