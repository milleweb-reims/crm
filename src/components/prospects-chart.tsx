"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface MonthlyData {
  readonly _id: { readonly year: number; readonly month: number };
  readonly count: number;
}

interface ProspectsChartProps {
  readonly data: readonly MonthlyData[];
}

const monthNames = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Jun",
  "Jul",
  "Aoû",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];

export function ProspectsChart({ data }: ProspectsChartProps) {
  const chartData = data.map((d) => ({
    name: `${monthNames[d._id.month - 1]} ${d._id.year}`,
    prospects: d.count,
  }));

  return (
    <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Prospects par mois
      </h3>
      <div className="h-[250px]">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Pas encore de données
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ec" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: "#667085" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#667085" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e4e7ec",
                  fontSize: "13px",
                }}
              />
              <Bar
                dataKey="prospects"
                fill="#6366f1"
                radius={[4, 4, 0, 0]}
                name="Prospects"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
