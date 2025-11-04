'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Gauge } from 'lucide-react';

import type { SurveyDistributionBucket } from 'server/src/interfaces/survey.interface';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';

type SatisfactionDistributionProps = {
  distribution: SurveyDistributionBucket[];
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
});

export default function SatisfactionDistribution({ distribution }: SatisfactionDistributionProps) {
  return (
    <Card className="col-span-1 flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold">Satisfaction Distribution</CardTitle>
        <Gauge className="h-4 w-4 text-emerald-500" />
      </CardHeader>
      <CardContent className="mt-2 flex-1">
        {distribution.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No survey ratings recorded yet.
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
