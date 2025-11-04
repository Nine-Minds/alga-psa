'use client';

import { useMemo } from 'react';
import { TrendingDown, CheckCircle2, Clock3, Star, Send } from 'lucide-react';

import type { SurveyDashboardMetrics } from 'server/src/interfaces/survey.interface';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';

type ResponseMetricsProps = {
  metrics: SurveyDashboardMetrics;
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const ratingFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function ResponseMetrics({ metrics }: ResponseMetricsProps) {
  const cards = useMemo(
    () => [
      {
        key: 'sent',
        label: 'Invitations Sent',
        value: integerFormatter.format(metrics.totalInvitations),
        icon: Send,
        tone: 'text-primary-600',
        background: 'bg-primary-50',
      },
      {
        key: 'responses',
        label: 'Responses Received',
        value: integerFormatter.format(metrics.totalResponses),
        icon: CheckCircle2,
        tone: 'text-emerald-600',
        background: 'bg-emerald-50',
      },
      {
        key: 'responseRate',
        label: 'Response Rate',
        value: percentFormatter.format(metrics.responseRate / 100),
        icon: Clock3,
        tone: 'text-blue-600',
        background: 'bg-blue-50',
      },
      {
        key: 'averageRating',
        label: 'Average Rating',
        value: metrics.averageRating !== null ? ratingFormatter.format(metrics.averageRating) : '—',
        icon: Star,
        tone: 'text-amber-600',
        background: 'bg-amber-50',
      },
    ],
    [metrics.averageRating, metrics.responseRate, metrics.totalInvitations, metrics.totalResponses]
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      {cards.map(({ key, label, value, icon: Icon, tone, background }) => (
        <Card key={key} className="h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            <span className={`rounded-full p-2 ${background}`}>
              <Icon className={`h-4 w-4 ${tone}`} />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{value}</div>
          </CardContent>
        </Card>
      ))}
      <Card className="sm:col-span-2 2xl:col-span-1">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Outstanding Invitations
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-2xl font-semibold">
            {integerFormatter.format(metrics.outstandingInvitations)}
          </div>
          <div className="flex items-center text-sm text-amber-600">
            <Clock3 className="mr-2 h-4 w-4" />
            Awaiting responses
          </div>
        </CardContent>
      </Card>
      <Card className="sm:col-span-2 2xl:col-span-1">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Negative Responses (≤ 2★)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-2xl font-semibold">
            {integerFormatter.format(metrics.recentNegativeResponses)}
          </div>
          <div className="flex items-center text-sm text-rose-600">
            <TrendingDown className="mr-2 h-4 w-4" />
            Needs review
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
