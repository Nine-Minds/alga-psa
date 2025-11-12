'use client';

import { useMemo } from 'react';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Sparkles } from 'lucide-react';

import type { SurveyTrendPoint } from 'server/src/interfaces/survey.interface';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';

type ResponseTrendChartProps = {
  trend: SurveyTrendPoint[];
};

export default function ResponseTrendChart({ trend }: ResponseTrendChartProps) {
  const ratingDomain = useMemo<[number, number]>(() => {
    if (trend.length === 0) {
      return [0, 5];
    }

    const maxRating = Math.max(
      0,
      ...trend
        .map((point) => point.averageRating ?? 0)
        .filter((value) => typeof value === 'number' && !Number.isNaN(value))
    );

    const upperBound = Math.max(5, Math.ceil(maxRating + 0.5));
    return [0, upperBound];
  }, [trend]);

  return (
    <Card className="col-span-1 flex flex-col border-border-200 shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold text-text-900">Response Trend</CardTitle>
        <div className="rounded-lg bg-primary-50 p-2 shadow-sm">
          <Sparkles className="h-4 w-4 text-primary-500" />
        </div>
      </CardHeader>
      <CardContent className="mt-2 flex-1">
        {trend.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg bg-gradient-to-br from-primary-50/30 to-transparent p-6">
            <div className="rounded-full bg-primary-100 p-3">
              <Sparkles className="h-6 w-6 text-primary-500" />
            </div>
            <p className="text-center text-sm font-medium text-text-600">
              No responses captured for the selected period.
            </p>
            <p className="text-center text-xs text-text-500">
              Check back after customers submit feedback.
            </p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="surveyTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(var(--color-primary-500))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="rgb(var(--color-primary-500))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                <XAxis dataKey="date" stroke="currentColor" fontSize={12} tickLine={false} />
                <YAxis
                  yAxisId="rating"
                  stroke="currentColor"
                  fontSize={12}
                  tickLine={false}
                  domain={ratingDomain}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="responses"
                  orientation="right"
                  stroke="currentColor"
                  fontSize={12}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: '0.75rem',
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'averageRating') {
                      return [`${value.toFixed(1)} ★`, 'Average Rating'];
                    }
                    if (name === 'responseCount') {
                      return [value, 'Responses'];
                    }
                    return [value, name];
                  }}
                  labelFormatter={(label: string) => `Date: ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="averageRating"
                  yAxisId="rating"
                  stroke="rgb(var(--color-primary-500))"
                  fill="url(#surveyTrend)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="responseCount"
                  yAxisId="responses"
                  stroke="rgb(var(--color-primary-300))"
                  fill="rgba(99, 102, 241, 0.15)"
                  strokeWidth={1}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
