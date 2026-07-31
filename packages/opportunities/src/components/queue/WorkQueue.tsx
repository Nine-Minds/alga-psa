'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LayoutGrid, List } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IWorkQueue } from '@alga-psa/types';
import { QueueGreeting } from './QueueGreeting';
import { QueueSection } from './QueueSection';
import { QueueActionRow } from './QueueActionRow';
import { MoneyFoundCard } from './MoneyFoundCard';
import { LessonStrip } from './LessonStrip';
import { QueueActionsTable } from './QueueActionsTable';

export interface WorkQueueProps {
  queue: IWorkQueue;
  onCompleteAction: (opportunityId: string, stage: IWorkQueue['do_today'][number]['stage']) => void;
  onOpenOpportunity: (opportunityId: string) => void;
  onSnooze: (opportunityId: string) => void;
  onMarkLost: (opportunityId: string) => void;
  onAcceptSuggestion: (suggestionId: string) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onSnoozeSuggestion: (suggestionId: string) => void;
  onViewSuggestionEvidence?: (suggestionId: string) => void;
  /** When drafting is available, overdue rows lead with the draft instead of the checkbox. */
  onReviewDraft?: (opportunityId: string) => void;
  preferenceKey: string;
}

/**
 * The Docket: a single finishable column. Do today → Going quiet → Money
 * found → one lesson → an explicit bottom. Never an open-ended dashboard;
 * a fully clear queue celebrates instead of showing an empty funnel.
 */
export function WorkQueue({
  queue,
  onCompleteAction,
  onOpenOpportunity,
  onSnooze,
  onMarkLost,
  onAcceptSuggestion,
  onDismissSuggestion,
  onSnoozeSuggestion,
  onViewSuggestionEvidence,
  onReviewDraft,
  preferenceKey,
}: WorkQueueProps) {
  const { t } = useTranslation('msp/opportunities');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const actionItems = useMemo(
    () => [...queue.do_today, ...queue.going_quiet],
    [queue.do_today, queue.going_quiet],
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(preferenceKey);
    if (saved === 'cards' || saved === 'table') setView(saved);
  }, [preferenceKey]);

  const changeView = (next: 'cards' | 'table') => {
    setView(next);
    window.localStorage.setItem(preferenceKey, next);
  };
  const draftOverride = (opportunityId: string, daysOverdue: number) =>
    onReviewDraft && daysOverdue > 0
      ? { label: t('opportunities.queue.reviewDraft', 'Review the draft'), onClick: () => onReviewDraft(opportunityId) }
      : undefined;
  const empty =
    queue.do_today.length === 0 && queue.going_quiet.length === 0 && queue.money_found.length === 0;

  return (
    <div id="opportunities-work-queue" className="mx-auto w-full max-w-5xl">
      <QueueGreeting
        firstName={queue.user_first_name}
        actionCount={queue.do_today.length}
        quietCount={queue.going_quiet.length}
        foundMrrCents={queue.found_mrr_cents}
        foundNrrCents={queue.found_nrr_cents}
        currencyCode={queue.currency_code}
      />

      {actionItems.length > 0 ? (
        <div className="mb-4 flex justify-end" role="group" aria-label={t('opportunities.queue.viewLabel', 'Queue view')}>
          <Button
            id="opportunities-queue-view-cards"
            size="xs"
            variant={view === 'cards' ? 'soft' : 'ghost'}
            aria-pressed={view === 'cards'}
            onClick={() => changeView('cards')}
          >
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('opportunities.queue.cardsView', 'Cards')}
          </Button>
          <Button
            id="opportunities-queue-view-table"
            size="xs"
            variant={view === 'table' ? 'soft' : 'ghost'}
            aria-pressed={view === 'table'}
            onClick={() => changeView('table')}
          >
            <List className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('opportunities.queue.tableView', 'Table')}
          </Button>
        </div>
      ) : null}

      {empty ? (
        <div
          id="opportunities-queue-clear"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[rgb(var(--color-border-300))] px-6 py-14 text-center"
        >
          <CheckCircle2 className="h-6 w-6 text-[rgb(var(--badge-success-text))]" aria-hidden />
          <p className="text-sm font-medium text-[rgb(var(--color-text-700))]">
            {t('opportunities.queue.allClear', 'All clear. Every open deal has a next step scheduled.')}
          </p>
        </div>
      ) : (
        <>
          {view === 'table' && actionItems.length > 0 ? (
            <QueueSection
              id="opportunities-queue-actions-table-section"
              label={t('opportunities.queue.actions', 'Actions')}
            >
              <QueueActionsTable
                items={actionItems}
                onComplete={onCompleteAction}
                onOpen={onOpenOpportunity}
                onSnooze={onSnooze}
              />
            </QueueSection>
          ) : null}

          {view === 'cards' && queue.do_today.length > 0 ? (
            <QueueSection
              id="opportunities-queue-do-today"
              label={t('opportunities.queue.doToday', 'Do today')}
            >
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {queue.do_today.map((item) => (
                  <QueueActionRow
                    key={item.opportunity_id}
                    item={item}
                    onComplete={onCompleteAction}
                    onOpen={onOpenOpportunity}
                    onSnooze={onSnooze}
                    primaryOverride={draftOverride(item.opportunity_id, item.days_overdue)}
                  />
                ))}
              </div>
            </QueueSection>
          ) : null}

          {view === 'cards' && queue.going_quiet.length > 0 ? (
            <QueueSection
              id="opportunities-queue-going-quiet"
              label={t('opportunities.queue.goingQuiet', 'Going quiet')}
            >
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {queue.going_quiet.map((item) => (
                  <QueueActionRow
                    key={item.opportunity_id}
                    item={item}
                    onComplete={onCompleteAction}
                    onOpen={onOpenOpportunity}
                    onSnooze={onSnooze}
                    onMarkLost={onMarkLost}
                  />
                ))}
              </div>
            </QueueSection>
          ) : null}

          {queue.money_found.length > 0 ? (
            <QueueSection
              id="opportunities-queue-money-found"
              label={t('opportunities.queue.moneyFound', 'Money found')}
              subtitle={t('opportunities.queue.moneyFoundSource', 'from billing, contracts, and assets')}
            >
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {queue.money_found.map((item) => (
                  <MoneyFoundCard
                    key={item.suggestion_id}
                    item={item}
                    onAccept={onAcceptSuggestion}
                    onDismiss={onDismissSuggestion}
                    onSnooze={onSnoozeSuggestion}
                    onViewEvidence={onViewSuggestionEvidence}
                  />
                ))}
              </div>
            </QueueSection>
          ) : null}
        </>
      )}

      {queue.lesson ? <LessonStrip lesson={queue.lesson} /> : null}

      {!empty ? (
        <p className="pb-2 pt-1 text-center text-[13px] text-[rgb(var(--color-text-400))]">
          {t('opportunities.queue.bottom', "That's everything. Nothing else needs you today.")}
        </p>
      ) : null}
    </div>
  );
}
