import { describe, it, expect } from "vitest";
import { handleChart, handleForm, handleMedia } from "./tools";

describe("mcp tool handlers", () => {
  it("chart handler acknowledges and echoes series count", () => {
    const res = handleChart({
      title: "Sales",
      kind: "bar",
      data: [
        { label: "Jan", value: 10 },
        { label: "Feb", value: 20 },
      ],
    });
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toContain("2");
  });

  it("form handler acknowledges field count", () => {
    const res = handleForm({
      title: "Contact",
      fields: [{ name: "email", label: "Email", type: "text" }],
    });
    expect(res.content[0].text).toContain("1");
  });

  it("media handler echoes the url", () => {
    const res = handleMedia({ url: "https://example.com/a.png", alt: "a" });
    expect(res.content[0].text).toContain("https://example.com/a.png");
  });
});
