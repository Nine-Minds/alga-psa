'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityListItem } from '@alga-psa/types';
import { opportunityValueParts } from '../../lib/format';

/**
 * A deal on the board. Cards move between columns only through evidence —
 * the card itself is presentational; the board owns the (restricted) drag rules.
 */
export function BoardCard({
  item,
  onOpen,
  draggable,
  onDragStart,
}: {
  item: IOpportunityListItem;
  onOpen: (opportunityId: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, item: IOpportunityListItem) => void;
}) {
  const { t } = useTranslation();
  const value = opportunityValueParts(item.mrr_cents, item.nrr_cents, item.hardware_cents, item.currency_code);

  return (
    <button
      type="button"
      id={`opportunity-board-card-${item.opportunity_id}`}
      className="mb-2 w-full rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-3 text-left shadow-sm transition-colors hover:border-[rgb(var(--color-primary-300))]"
      onClick={() => onOpen(item.opportunity_id)}
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, item) : undefined}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-snug text-[rgb(var(--color-text-900))]">
          {item.title}
        </span>
        {item.is_stalled ? (
          <Badge variant="warning" size="sm">
            {t('opportunities.board.daysQuiet', '{{count}}d quiet', { count: item.days_since_activity })}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-500))]">
        {item.client_name}
        {item.client_lifecycle_status === 'prospect' ? (
          <Badge variant="default-muted" size="sm">{t('opportunities.prospect', 'Prospect')}</Badge>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium tabular-nums text-[rgb(var(--color-text-700))]">
          {value.amount}
          {value.recurring ? t('opportunities.perMonthSuffix', '/mo') : ''}
        </span>
        {item.next_action_due ? (
          <span className="text-[11px] text-[rgb(var(--color-text-400))]">
            {t('opportunities.board.nextDue', 'next: {{date}}', {
              date: new Date(item.next_action_due).toLocaleDateString(),
            })}
          </span>
        ) : null}
      </div>
    </button>
  );
}
