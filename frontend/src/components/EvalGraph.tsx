import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
  Legend,
} from "recharts";
import type { EngineScore } from "../api/types";
import { scoreToUnits, wpFromUnits } from "../lib/format";

export interface EvalPoint {
  ply: number;
  units: number | null;
  wp: number | null;
}

export interface EvalMark {
  ply: number;
  units: number;
  category: string;
}

export function EvalGraph({
  points,
  marks,
  onClick,
  height = 260,
}: {
  points: EvalPoint[];
  marks?: EvalMark[];
  onClick?: (ply: number) => void;
  height?: number;
}) {
  const scatterData = (marks ?? []).map((m) => ({ x: m.ply, y: m.units, category: m.category, ply: m.ply }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: -14 }}>
          <CartesianGrid stroke="#292524" strokeDasharray="3 3" />
          <XAxis
            dataKey="ply"
            type="number"
            domain={[0, "dataMax"]}
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "#a8a29e" }}
          />
          <YAxis
            yAxisId="cp"
            width={54}
            tick={{ fontSize: 10, fill: "#a8a29e" }}
            domain={[-900, 900]}
            tickFormatter={(v: number) => (v >= 0 ? `+${(v / 100).toFixed(1)}` : (v / 100).toFixed(1))}
          />
          <YAxis yAxisId="wp" orientation="right" domain={[0, 1]} hide />
          <Tooltip
            contentStyle={{ background: "#1c1917", border: "1px solid #44403c", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(v) => `Ply ${v}`}
            content={({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: number | string }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-lg border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-xs text-stone-200 shadow-lg">
                  <div className="mb-1 font-semibold">Ply {label}</div>
                  {payload.map((p, i) => {
                    if (p.value === undefined || Number.isNaN(Number(p.value))) return null;
                    const val = Number(p.value);
                    if (p.name === "critical") return <div key={i} className="text-amber-300">◆ critical move</div>;
                    if (p.name === "wp") {
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? "#8b5cf6" }} />
                          Win prob {(val * 100).toFixed(0)}%
                        </div>
                      );
                    }
                    if (p.name === "cp") {
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? "#34d399" }} />
                          White eval {val >= 0 ? `+${(val / 100).toFixed(2)}` : (val / 100).toFixed(2)}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine yAxisId="cp" y={0} stroke="#57534e" />
          <Line
            yAxisId="cp"
            type="monotone"
            dataKey="units"
            name="cp"
            stroke="#34d399"
            dot={false}
            strokeWidth={2}
            connectNulls
            activeDot={{ r: 4, cursor: "pointer" }}
          />
          <Line yAxisId="wp" type="monotone" dataKey="wp" name="wp" stroke="#8b5cf6" dot={false} strokeWidth={1.5} strokeDasharray="4 3" connectNulls />
          <Scatter
            yAxisId="cp"
            data={scatterData}
            dataKey="y"
            name="critical"
            shape={((props: { cx?: number; cy?: number; payload?: { category?: string; ply?: number } }) => {
              const { cx, cy, payload } = props;
              if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;
              const c = payload.category ?? "";
              const color = c.includes("blunder") ? "#ef4444" : c.includes("mistake") ? "#f59e0b" : c.includes("best") || c.includes("brilliant") ? "#10b981" : "#facc15";
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={4.5}
                  fill={color}
                  stroke="#1c1917"
                  strokeWidth={1}
                  onClick={() => onClick?.(payload.ply ?? 0)}
                  style={{ cursor: "pointer" }}
                />
              );
            }) as never}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Build graph points from review positions. */
export function pointsFromReview(
  positions: Array<{ ply: number; eval: EngineScore | null }>,
): EvalPoint[] {
  return (positions ?? []).map((p) => {
    const units = scoreToUnits(p.eval);
    return { ply: p.ply, units, wp: units === null ? null : wpFromUnits(units) };
  });
}