'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { IOpportunityListItem, IOpportunityMeetingReview, IOpportunityMeetingSessionDetail } from '@alga-psa/types';
import { listOpportunities } from '@alga-psa/opportunities/actions';
import { getActiveMeetingSession, markDealReviewed, startMeetingSession } from '@enterprise/lib/opportunities/actions';

/**
 * Monday meeting mode: the pipeline reviewed deal by deal, on the record.
 * The screen shows what the evidence says next to what the rep claims —
 * the gap is the conversation.
 */
export function OpportunityMeetingMode() {
  const { t } = useTranslation();
  const router = useRouter();
  const [session, setSession] = useState<IOpportunityMeetingSessionDetail | null>(null);
  const [deals, setDeals] = useState<IOpportunityListItem[] | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // CE stubs type as Promise<never>; the real EE types are asserted at this boundary.
        const [active, list] = await Promise.all([
          getActiveMeetingSession() as Promise<IOpportunityMeetingSessionDetail | null>,
          listOpportunities({ status: 'open', page: 1, page_size: 100, sort_by: 'last_activity_at', sort_direction: 'asc' }),
        ]);
        const current = active ?? ((await startMeetingSession()) as IOpportunityMeetingSessionDetail);
        if (!mounted) return;
        setSession(current);
        setDeals(list.data);
        const reviewedIds = new Set(current.reviews.map((r) => r.opportunity_id));
        const firstUnreviewed = list.data.findIndex((d) => !reviewedIds.has(d.opportunity_id));
        setCursor(firstUnreviewed === -1 ? list.data.length : firstUnreviewed);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const reviewedIds = useMemo(() => new Set(session?.reviews.map((r) => r.opportunity_id) ?? []), [session]);

  const review = useCallback(async () => {
    if (!session || !deals) return;
    const deal = deals[cursor];
    if (!deal) return;
    try {
      const created = (await markDealReviewed({
        session_id: session.session_id,
        opportunity_id: deal.opportunity_id,
      })) as IOpportunityMeetingReview;
      setSession({ ...session, reviews: [...session.reviews, created] });
      setCursor((c) => c + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [session, deals, cursor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') void review();
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review]);

  if (!deals || !session) return <Skeleton className="h-72 w-full" />;

  if (deals.length === 0 || cursor >= deals.length) {
    return (
      <div
        id="opportunities-meeting-done"
        className="mx-auto flex max-w-xl flex-col items-center gap-2 rounded-xl border border-dashed border-[rgb(var(--color-border-300))] px-6 py-14 text-center"
      >
        <CheckCircle2 className="h-6 w-6 text-[rgb(var(--badge-success-text))]" aria-hidden />
        <p className="text-sm font-medium text-[rgb(var(--color-text-700))]">
          {t('opportunities.meeting.done', 'Pipeline reviewed. {{count}} deals on the record.', {
            count: session.reviews.length,
          })}
        </p>
      </div>
    );
  }

  const deal = deals[cursor];
  const fmt = (cents: number) => formatCurrencyFromMinorUnits(cents, undefined, deal.currency_code);
  const stageLabel = t(`opportunities.stage.${deal.stage}`, deal.stage);
  const confidenceLabel = t(`opportunities.confidence.${deal.confidence}`, deal.confidence);
  const optimistGap =
    (deal.confidence === 'high' || deal.confidence === 'committed') &&
    (deal.stage === 'identified' || deal.stage === 'qualified');

  return (
    <div id="opportunities-meeting" className="mx-auto w-full max-w-2xl">
      <div className="mb-3 flex items-center justify-between text-[13px] text-[rgb(var(--color-text-500))]">
        <span>
          {t('opportunities.meeting.progress', 'Deal {{n}} of {{total}}', { n: cursor + 1, total: deals.length })}
        </span>
        <span>{t('opportunities.meeting.keys', '← back · → reviewed')}</span>
      </div>

      <div className="rounded-2xl border border-[rgb(var(--color-border-200))] bg-white p-6 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{deal.title}</h2>
          {reviewedIds.has(deal.opportunity_id) ? (
            <Badge variant="success" size="sm">{t('opportunities.meeting.reviewed', 'Reviewed')}</Badge>
          ) : null}
        </div>
        <div className="mb-4 text-sm text-[rgb(var(--color-text-500))]">
          {deal.client_name} · {deal.owner_name} ·{' '}
          <span className="tabular-nums">
            {fmt(deal.mrr_cents)}{t('opportunities.perMonthSuffix', '/mo')}
            {deal.nrr_cents + deal.hardware_cents > 0 ? ` + ${fmt(deal.nrr_cents + deal.hardware_cents)}` : ''}
          </span>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-[rgb(var(--color-border-50,248_250_252))] p-3">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
              {t('opportunities.meeting.evidenceSays', 'Evidence says')}
            </div>
            <div className="text-sm font-semibold text-[rgb(var(--color-text-900))]">{stageLabel}</div>
          </div>
          <div className="rounded-lg bg-[rgb(var(--color-border-50,248_250_252))] p-3">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
              {t('opportunities.meeting.repSays', 'Owner says')}
            </div>
            <div className="text-sm font-semibold text-[rgb(var(--color-text-900))]">{confidenceLabel}</div>
          </div>
          <div className="rounded-lg bg-[rgb(var(--color-border-50,248_250_252))] p-3">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
              {t('opportunities.meeting.silence', 'Last touch')}
            </div>
            <div className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {t('opportunities.meeting.daysAgo', '{{count}} days ago', { count: deal.days_since_activity })}
            </div>
          </div>
        </div>

        {optimistGap ? (
          <p className="mb-4 rounded-lg border border-[rgb(var(--badge-warning-border,253_230_138))] bg-[rgb(var(--badge-warning-bg,255_251_235))] px-3 py-2 text-[13px] text-[rgb(var(--badge-warning-text,146_64_14))]">
            {t(
              'opportunities.meeting.gap',
              'Confidence is {{confidence}} but the evidence stops at {{stage}}. What has the client actually done?',
              { confidence: confidenceLabel, stage: stageLabel }
            )}
          </p>
        ) : null}

        <div className="mb-5 text-sm">
          <span className="text-[rgb(var(--color-text-400))]">{t('opportunities.meeting.next', 'Next action:')} </span>
          <span className="font-medium text-[rgb(var(--color-text-900))]">
            {deal.next_action ?? t('opportunities.meeting.noAction', 'none set')}
          </span>
          {deal.next_action_due ? (
            <span className="text-[rgb(var(--color-text-400))]">
              {' '}
              · {t('opportunities.detail.due', 'due {{date}}', { date: new Date(deal.next_action_due).toLocaleDateString() })}
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-between">
          <Button
            id="opportunities-meeting-open"
            size="sm"
            variant="ghost"
            onClick={() => router.push(`/msp/opportunities/${deal.opportunity_id}`)}
          >
            {t('opportunities.queue.openDeal', 'Open deal')}
          </Button>
          <div className="flex gap-2">
            <Button
              id="opportunities-meeting-back"
              size="sm"
              variant="outline"
              disabled={cursor === 0}
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
            >
              {t('common.back', 'Back')}
            </Button>
            <Button id="opportunities-meeting-reviewed" size="sm" onClick={() => void review()}>
              {t('opportunities.meeting.markReviewed', 'Reviewed → next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
