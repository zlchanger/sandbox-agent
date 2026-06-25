import { makeAssistantToolUI } from "@assistant-ui/react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

type ChartArgs = { title: string; kind: "line" | "bar"; data: { label: string; value: number }[] };

export const ChartToolUI = makeAssistantToolUI<ChartArgs, unknown>({
  toolName: "render_chart",
  display: "standalone",
  render: ({ args }) => {
    const data = args?.data ?? [];
    return (
      <div style={{ margin: "8px 0" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{args?.title}</div>
        {args?.kind === "bar" ? (
          <BarChart width={360} height={200} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#0066cc" />
          </BarChart>
        ) : (
          <LineChart width={360} height={200} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Line dataKey="value" stroke="#0066cc" />
          </LineChart>
        )}
      </div>
    );
  },
});
