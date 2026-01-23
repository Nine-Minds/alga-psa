'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Gauge } from 'lucide-react';

import type { SurveyDistributionBucket } from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';

type SatisfactionDistributionProps = {
  distribution: SurveyDistributionBucket[];
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
});

export default function SatisfactionDistribution({ distribution }: SatisfactionDistributionProps) {
  return (
    <Card className="col-span-1 flex flex-col border-border-200 shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold text-text-900">Satisfaction Distribution</CardTitle>
        <div className="rounded-lg bg-emerald-50 p-2 shadow-sm">
          <Gauge className="h-4 w-4 text-emerald-500" />
        </div>
      </CardHeader>
      <CardContent className="mt-2 flex-1">
        {distribution.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg bg-gradient-to-br from-emerald-50/30 to-transparent p-6">
            <div className="rounded-full bg-emerald-100 p-3">
              <Gauge className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-center text-sm font-medium text-text-600">
              No survey ratings recorded yet.
            </p>
            <p className="text-center text-xs text-text-500">
              Distribution will appear after feedback is collected.
            </p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                <XAxis
                  dataKey="rating"
                  stroke="currentColor"
                  fontSize={12}
                  tickLine={false}
                  label={{ value: 'Rating', position: 'insideBottom', offset: -4 }}
                />
                <YAxis
                  stroke="currentColor"
                  fontSize={12}
                  tickLine={false}
                  allowDecimals={false}
                  label={{ value: 'Responses', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(79, 70, 229, 0.05)' }}
                  formatter={(value: number, name: string, payload) => {
                    if (name === 'percentage') {
                      return [percentFormatter.format(value / 100), 'Percent'];
                    }
                    if (name === 'count') {
                      return [value, 'Responses'];
                    }
                    return [value, name];
                  }}
                  labelFormatter={(label) => `Rating: ${label}`}
                />
                <Bar
                  dataKey="count"
                  radius={[6, 6, 0, 0]}
                  fill="rgb(var(--color-primary-500))"
                  name="count"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
