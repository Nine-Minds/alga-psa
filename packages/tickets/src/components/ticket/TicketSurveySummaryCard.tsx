'use client';

import { Star, MessageCircle } from 'lucide-react';
import { ContentCard } from '@alga-psa/ui/components';
import type { SurveyTicketSatisfactionSummary } from '@alga-psa/types';

type TicketSurveySummaryCardProps = {
  summary: SurveyTicketSatisfactionSummary | null | undefined;
};

export default function TicketSurveySummaryCard({ summary }: TicketSurveySummaryCardProps) {
  return (
    <ContentCard>
      <ContentCard.Header>
        <Star className="w-5 h-5 mr-2" />
        Customer Feedback
      </ContentCard.Header>

      {!summary || summary.totalResponses === 0 ? (
        <div className="text-gray-500 text-center py-8">
          No survey responses received for this ticket yet.
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Latest Rating</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-semibold text-primary-700">
                {summary.latestResponseRating ?? '—'} ★
              </span>
              {summary.latestResponseAt && (
                <span className="text-xs text-gray-500">
                  {new Date(summary.latestResponseAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {summary.latestResponseComment?.trim() && (
            <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
              <div className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                <MessageCircle className="mr-2 h-3 w-3" />
                Comment
              </div>
              <p className="leading-relaxed">
                {summary.latestResponseComment}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-gray-500 pt-2 border-t">
            <span>Total responses</span>
            <span className="font-medium text-gray-900">{summary.totalResponses}</span>
          </div>
        </div>
      )}
    </ContentCard>
  );
}
