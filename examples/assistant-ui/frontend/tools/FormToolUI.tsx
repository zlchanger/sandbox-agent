import { createContext, useContext, useState } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";

export const SubmitContext = createContext<(text: string) => void>(() => {});

type FormField = { name: string; label: string; type?: string };
type FormArgs = { title: string; fields: FormField[] };

export const FormToolUI = makeAssistantToolUI<FormArgs, unknown>({
  toolName: "collect_form",
  display: "standalone",
  render: ({ args }) => {
    const submit = useContext(SubmitContext);
    const [values, setValues] = useState<Record<string, string>>({});
    const [done, setDone] = useState(false);
    const fields = args?.fields ?? [];

    if (done) return <div style={{ color: "#2a7", margin: "8px 0" }}>Submitted.</div>;

    return (
      <form
        style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0", maxWidth: 360 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit(`Form "${args?.title}" submitted: ${JSON.stringify(values)}`);
          setDone(true);
        }}
      >
        <div style={{ fontWeight: 600 }}>{args?.title}</div>
        {fields.map((f) => (
          <label key={f.name} style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
            {f.label}
            <input
              type={f.type ?? "text"}
              value={values[f.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              style={{ padding: 4 }}
            />
          </label>
        ))}
        <button type="submit" style={{ padding: "4px 10px", alignSelf: "flex-start" }}>
          Submit
        </button>
      </form>
    );
  },
});
