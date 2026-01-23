'use client';

import { Star, MessageCircle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import type { SurveyTicketSatisfactionSummary } from '@alga-psa/types';

type TicketSurveySummaryCardProps = {
  summary: SurveyTicketSatisfactionSummary | null | undefined;
};

export default function TicketSurveySummaryCard({ summary }: TicketSurveySummaryCardProps) {
  return (
    <Card className="mb-6 border-primary-100 bg-primary-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-sm font-semibold text-primary-700">
          <Star className="mr-2 h-4 w-4" />
          Customer Feedback
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!summary || summary.totalResponses === 0 ? (
          <div className="text-sm text-muted-foreground">
            No survey responses received for this ticket yet. Responses will appear here once the
            customer submits feedback.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Latest Rating</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-2xl font-semibold text-primary-700">
                  {summary.latestResponseRating ?? '—'} ★
                </span>
                {summary.latestResponseAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(summary.latestResponseAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-md bg-white/70 p-3 text-sm text-gray-700">
              <div className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageCircle className="mr-2 h-3 w-3" />
                Comment
              </div>
              <p className="leading-relaxed">
                {summary.latestResponseComment?.trim() ? summary.latestResponseComment : 'No comment provided.'}
              </p>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Total responses</span>
              <span className="font-medium text-gray-900">{summary.totalResponses}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
