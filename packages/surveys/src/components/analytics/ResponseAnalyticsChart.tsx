'use client';

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';

type AnalyticsDataPoint = {
  label: string;
  averageRating: number;
  responseRate: number;
  responseCount: number;
};

type ResponseAnalyticsChartProps = {
  data: AnalyticsDataPoint[];
};

export default function ResponseAnalyticsChart({ data }: ResponseAnalyticsChartProps) {
  return (
    <div className="h-96">
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Select filters above to explore advanced analytics. (Coming soon)
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis dataKey="label" stroke="currentColor" fontSize={12} tickLine={false} />
            <YAxis yAxisId="rating" stroke="currentColor" domain={[0, 10]} allowDecimals={false} />
            <YAxis yAxisId="rate" orientation="right" stroke="currentColor" domain={[0, 100]} />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === 'averageRating') {
                  return [`${value.toFixed(1)} ★`, 'Average Rating'];
                }
                if (name === 'responseRate') {
                  return [`${value.toFixed(1)}%`, 'Response Rate'];
                }
                return [value, name];
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="averageRating"
              yAxisId="rating"
              stroke="rgb(var(--color-primary-500))"
              strokeWidth={2}
              dot={false}
              name="Average Rating"
            />
            <Line
              type="monotone"
              dataKey="responseRate"
              yAxisId="rate"
              stroke="rgb(var(--color-primary-300))"
              strokeWidth={2}
              dot={false}
              name="Response Rate"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
