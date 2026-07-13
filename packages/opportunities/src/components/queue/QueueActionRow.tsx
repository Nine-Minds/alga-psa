'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IQueueActionItem } from '@alga-psa/types';
import { WhySentenceText } from '../WhySentenceText';
import { opportunityValueParts } from '../../lib/format';

export interface QueueActionRowProps {
  item: IQueueActionItem;
  /** Complete the next action; the caller opens the set-next-action prompt (the chain never breaks). */
  onComplete: (opportunityId: string) => void;
  onOpen: (opportunityId: string) => void;
  onSnooze: (opportunityId: string) => void;
  /** Only offered on going-quiet rows. */
  onMarkLost?: (opportunityId: string) => void;
  /**
   * Optional contextual primary action ("Review the draft", "Start the quote").
   * Falls back to the complete action when absent.
   */
  primaryOverride?: { label: string; onClick: () => void };
}

/**
 * One row of the Docket: tick affordance, action title with the deal's value,
 * a why-sentence, and its actions. Exactly one row on the screen is the
 * primary (item.is_screen_primary) — every other row stays soft/ghost.
 */
export function QueueActionRow({ item, onComplete, onOpen, onSnooze, onMarkLost, primaryOverride }: QueueActionRowProps) {
  const { t } = useTranslation();
  const overdue = item.days_overdue > 0;
  const value = opportunityValueParts(item.mrr_cents, item.nrr_cents, item.hardware_cents, item.currency_code);
  const idBase = `opportunity-queue-row-${item.opportunity_id}`;

  const primaryLabel = primaryOverride?.label ?? t('opportunities.queue.completeAction', 'Done → set next');
  const primaryClick = primaryOverride?.onClick ?? (() => onComplete(item.opportunity_id));

  return (
    <div
      id={idBase}
      className="mb-2 flex gap-3.5 rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4 transition-colors hover:border-[rgb(var(--color-primary-300))] dark:bg-[rgb(var(--color-card-bg,255_255_255))]"
    >
      <span
        aria-hidden
        className={`mt-0.5 h-5 w-5 flex-none rounded-full border-2 ${
          overdue ? 'border-[rgb(var(--color-accent-400))]' : 'border-[rgb(var(--color-border-400))]'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
            {item.next_action ?? item.title}
          </span>
          <span className="text-xs tabular-nums text-[rgb(var(--color-text-500))]">
            {value.amount}
            {value.recurring ? t('opportunities.perMonthSuffix', '/mo') : ''}
            {value.secondaryAmount
              ? ` + ${t('opportunities.oneTimeAmount', '{{amount}} one-time', { amount: value.secondaryAmount })}`
              : ''}
          </span>
          {overdue ? (
            <Badge variant="error" size="sm">
              {t('opportunities.queue.daysOverdue', '{{count}} days overdue', { count: item.days_overdue })}
            </Badge>
          ) : item.kind === 'going_quiet' ? (
            <Badge variant="warning" size="sm">
              {t('opportunities.queue.daysQuiet', '{{count}} days quiet', { count: item.days_since_activity })}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 mb-2.5 text-[13px] leading-relaxed text-[rgb(var(--color-text-500))]">
          <WhySentenceText why={item.why} />
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            id={`${idBase}-primary`}
            size="xs"
            variant={item.is_screen_primary ? 'default' : 'soft'}
            onClick={primaryClick}
          >
            {primaryLabel}
          </Button>
          <Button id={`${idBase}-open`} size="xs" variant="outline" onClick={() => onOpen(item.opportunity_id)}>
            {t('opportunities.queue.openDeal', 'Open deal')}
          </Button>
          <Button id={`${idBase}-snooze`} size="xs" variant="ghost" onClick={() => onSnooze(item.opportunity_id)}>
            {t('opportunities.queue.snooze', 'Snooze')}
          </Button>
          {item.kind === 'going_quiet' && onMarkLost ? (
            <Button id={`${idBase}-lost`} size="xs" variant="ghost" onClick={() => onMarkLost(item.opportunity_id)}>
              {t('opportunities.queue.markLost', 'Mark lost')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
