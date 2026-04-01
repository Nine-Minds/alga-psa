'use client';

import { Star, MessageCircle } from 'lucide-react';
import { ContentCard } from '@alga-psa/ui/components';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { SurveyTicketSatisfactionSummary } from '@alga-psa/types';

type TicketSurveySummaryCardProps = {
  id?: string;
  summary: SurveyTicketSatisfactionSummary | null | undefined;
};

export default function TicketSurveySummaryCard({ id = 'ticket-survey-summary', summary }: TicketSurveySummaryCardProps) {
  const { t } = useTranslation('msp/surveys');
  const { formatDate } = useFormatters();
  const hasContent = !!summary && summary.totalResponses > 0;

  return (
    <ContentCard
      id={id}
      collapsible
      defaultExpanded={hasContent}
      title={t('ticketSummary.title', { defaultValue: 'Customer Feedback' })}
      headerIcon={<Star className="w-5 h-5" />}
      count={summary?.totalResponses}
    >
      {!hasContent ? (
        <div className="py-8 text-center text-gray-500">
          {t('ticketSummary.empty', {
            defaultValue: 'No survey responses received for this ticket yet.',
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {t('ticketSummary.labels.latestRating', { defaultValue: 'Latest Rating' })}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-semibold text-primary-700">
                {summary?.latestResponseRating ?? t('ticketSummary.fallbacks.none', { defaultValue: '-' })} ★
              </span>
              {summary?.latestResponseAt && (
                <span className="text-xs text-gray-500">
                  {formatDate(summary.latestResponseAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              )}
            </div>
          </div>

          {summary?.latestResponseComment?.trim() && (
            <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
              <div className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                <MessageCircle className="mr-2 h-3 w-3" />
                {t('ticketSummary.labels.comment', { defaultValue: 'Comment' })}
              </div>
              <p className="leading-relaxed">{summary.latestResponseComment}</p>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-2 text-sm text-gray-500">
            <span>{t('ticketSummary.labels.totalResponses', { defaultValue: 'Total responses' })}</span>
            <span className="font-medium text-gray-900">{summary?.totalResponses}</span>
          </div>
        </div>
      )}
    </ContentCard>
  );
}
