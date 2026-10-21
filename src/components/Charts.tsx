"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell
} from "recharts";

export function MonthlyNetChart({
  data,
  symbol = "$",
  decimals = 2
}: {
  data: { month: string; net: number; gross: number }[];
  // Values are pre-converted to the display currency; these just format labels.
  symbol?: string;
  decimals?: number;
}) {
  if (data.length === 0) {
    return <div className="py-12 text-center text-sm text-slate-400">No sales yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="var(--chart-tick)" />
        <YAxis tick={{ fontSize: 12 }} stroke="var(--chart-tick)" tickFormatter={(v) => `${symbol}${v}`} />
        <Tooltip
          formatter={(v: number) => `${symbol}${v.toFixed(decimals)}`}
          contentStyle={{ borderRadius: 8, border: "1px solid rgb(var(--slate-200))", backgroundColor: "rgb(var(--surface))", color: "rgb(var(--slate-800))", fontSize: 12 }}
          // Per-Cell fills make Recharts default the value line to black — use theme ink.
          itemStyle={{ color: "rgb(var(--slate-800))" }}
          labelStyle={{ color: "rgb(var(--slate-800))", fontWeight: 600 }}
        />
        <Bar dataKey="net" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.net >= 0 ? "#10b981" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HBarChart({
  data,
  symbol = "",
  suffix = "",
  decimals = 2
}: {
  // `fullName` (optional) is the untruncated label — the hover tooltip shows it
  // while the axis keeps the shortened `name`.
  data: { name: string; value: number; fullName?: string }[];
  // Money charts pre-convert values + pass a currency symbol; non-money lenses
  // (ROI %, counts, days) pass a suffix / no symbol instead.
  symbol?: string;
  suffix?: string;
  decimals?: number;
}) {
  if (data.length === 0) {
    return <div className="py-12 text-center text-sm text-slate-400">Not enough data yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} stroke="var(--chart-tick)" />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tick={{ fontSize: 12 }}
          stroke="var(--chart-tick)"
        />
        <Tooltip
          formatter={(v: number) => `${symbol}${v.toFixed(decimals)}${suffix}`}
          labelFormatter={(label, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName ?? label}
          contentStyle={{ borderRadius: 8, border: "1px solid rgb(var(--slate-200))", backgroundColor: "rgb(var(--surface))", color: "rgb(var(--slate-800))", fontSize: 12, maxWidth: 280, whiteSpace: "normal" }}
          // Recharts falls back to BLACK for the value line when the series color
          // lives on per-Cell fills — unreadable on the dark theme. Use theme ink.
          itemStyle={{ color: "rgb(var(--slate-800))" }}
          labelStyle={{ color: "rgb(var(--slate-800))", fontWeight: 600 }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? "#2f6df6" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
