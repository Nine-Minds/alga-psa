'use client';

import { LineChart, TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import type { SurveyClientSatisfactionSummary } from 'server/src/interfaces/survey.interface';

type ClientSurveySummaryCardProps = {
  summary: SurveyClientSatisfactionSummary | null;
};

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export default function ClientSurveySummaryCard({ summary }: ClientSurveySummaryCardProps) {
  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold text-gray-900">CSAT Summary</CardTitle>
        <TrendingUp className="h-4 w-4 text-primary-500" />
      </CardHeader>
      <CardContent>
        {!summary ? (
          <div className="text-sm text-muted-foreground">
            No survey data available for this client yet. Surveys sent after ticket closures will populate this view.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Average Rating</div>
                <div className="mt-1 text-2xl font-semibold text-primary-700">
                  {summary.averageRating !== null ? `${numberFormat.format(summary.averageRating)} ★` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Response Rate</div>
                <div className="mt-1 text-2xl font-semibold text-primary-700">
                  {summary.responseRate !== null ? `${numberFormat.format(summary.responseRate)}%` : '—'}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted p-3 text-sm">
              <span>Total responses</span>
              <span className="font-semibold text-gray-900">{summary.totalResponses}</span>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Last response</div>
              <div className="mt-1 text-sm text-gray-700">
                {summary.lastResponseAt
                  ? new Date(summary.lastResponseAt).toLocaleString()
                  : 'No responses yet'}
              </div>
            </div>

            {summary.trend.length > 0 && (
              <div>
                <div className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <LineChart className="mr-2 h-3 w-3" />
                  Rolling Trend
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {summary.trend.slice(-4).map((point) => (
                    <li key={point.date} className="flex items-center justify-between">
                      <span>{point.date}</span>
                      <span className="font-medium text-gray-700">
                        {point.averageRating !== null ? `${numberFormat.format(point.averageRating)} ★` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
