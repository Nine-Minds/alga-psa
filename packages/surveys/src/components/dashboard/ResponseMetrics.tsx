'use client';

import { useMemo } from 'react';
import { TrendingDown, CheckCircle2, Clock3, Star, Send } from 'lucide-react';

import type { SurveyDashboardMetrics } from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ResponseMetricsProps = {
  metrics: SurveyDashboardMetrics;
};

export default function ResponseMetrics({ metrics }: ResponseMetricsProps) {
  const { t } = useTranslation('msp/surveys');
  const { formatNumber } = useFormatters();

  const cards = useMemo(
    () => [
      {
        key: 'sent',
        label: t('dashboard.responseMetrics.cards.sent', {
          defaultValue: 'Invitations Sent',
        }),
        value: formatNumber(metrics.totalInvitations, { maximumFractionDigits: 0 }),
        icon: Send,
        tone: 'text-primary-600',
        background: 'bg-primary-500/10',
      },
      {
        key: 'responses',
        label: t('dashboard.responseMetrics.cards.responses', {
          defaultValue: 'Responses Received',
        }),
        value: formatNumber(metrics.totalResponses, { maximumFractionDigits: 0 }),
        icon: CheckCircle2,
        tone: 'text-emerald-600 dark:text-emerald-400',
        background: 'bg-emerald-500/10',
      },
      {
        key: 'responseRate',
        label: t('dashboard.responseMetrics.cards.responseRate', {
          defaultValue: 'Response Rate',
        }),
        value: formatNumber(metrics.responseRate / 100, {
          style: 'percent',
          maximumFractionDigits: 1,
        }),
        icon: Clock3,
        tone: 'text-blue-600 dark:text-blue-400',
        background: 'bg-blue-500/10',
      },
      {
        key: 'averageRating',
        label: t('dashboard.responseMetrics.cards.averageRating', {
          defaultValue: 'Average Rating',
        }),
        value:
          metrics.averageRating !== null
            ? formatNumber(metrics.averageRating, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })
            : '-',
        icon: Star,
        tone: 'text-amber-600 dark:text-amber-400',
        background: 'bg-warning/10',
      },
    ],
    [formatNumber, metrics.averageRating, metrics.responseRate, metrics.totalInvitations, metrics.totalResponses, t]
  );

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-4">
      {cards.map(({ key, label, value, icon: Icon, tone, background }) => (
        <Card key={key} className="h-full border-border-200 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-medium text-text-600">{label}</CardTitle>
            <span className={`rounded-lg p-2.5 ${background} shadow-sm`}>
              <Icon className={`h-5 w-5 ${tone}`} />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight text-text-900">{value}</div>
          </CardContent>
        </Card>
      ))}
      <Card className="sm:col-span-2 2xl:col-span-1 border-border-200 bg-gradient-to-br from-warning/5 to-transparent transition-all duration-200 hover:scale-[1.02] hover:shadow-lg">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-sm font-medium text-text-600">
            {t('dashboard.responseMetrics.cards.outstanding', {
              defaultValue: 'Outstanding Invitations',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-3xl font-bold tracking-tight text-text-900">
            {formatNumber(metrics.outstandingInvitations, { maximumFractionDigits: 0 })}
          </div>
          <div className="flex items-center gap-2 rounded-full bg-warning/15 px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
            <Clock3 className="h-4 w-4" />
            {t('dashboard.responseMetrics.badges.awaitingResponses', {
              defaultValue: 'Awaiting responses',
            })}
          </div>
        </CardContent>
      </Card>
      <Card className="sm:col-span-2 2xl:col-span-1 border-border-200 bg-gradient-to-br from-destructive/5 to-transparent transition-all duration-200 hover:scale-[1.02] hover:shadow-lg">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-sm font-medium text-text-600">
            {t('dashboard.responseMetrics.cards.negative', {
              defaultValue: 'Negative Responses (<= 2 stars)',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-3xl font-bold tracking-tight text-text-900">
            {formatNumber(metrics.recentNegativeResponses, { maximumFractionDigits: 0 })}
          </div>
          <div className="flex items-center gap-2 rounded-full bg-destructive/15 px-3 py-1.5 text-sm font-medium text-rose-700 dark:text-rose-300">
            <TrendingDown className="h-4 w-4" />
            {t('dashboard.responseMetrics.badges.needsReview', {
              defaultValue: 'Needs review',
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
