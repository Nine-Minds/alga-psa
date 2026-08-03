'use client';

import React from 'react';
import Link from 'next/link';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useClientDrawer } from '@alga-psa/ui';
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
  const { t } = useTranslation('msp/opportunities');
  const clientDrawer = useClientDrawer();
  const value = opportunityValueParts(item.mrr_cents, item.nrr_cents, item.hardware_cents, item.currency_code);

  return (
    <div
      id={`opportunity-board-card-${item.opportunity_id}`}
      className="mb-2 w-full rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3 text-left shadow-sm transition-colors hover:border-[rgb(var(--color-primary-300))]"
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, item) : undefined}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <button
          id={`opportunity-board-open-${item.opportunity_id}`}
          type="button"
          className="text-[13px] font-semibold leading-snug text-[rgb(var(--color-text-900))] hover:text-[rgb(var(--color-primary-600))] hover:underline"
          onClick={() => onOpen(item.opportunity_id)}
        >
          {item.title}
        </button>
        {item.is_stalled ? (
          <Badge variant="warning" size="sm">
            {t('opportunities.board.daysQuiet', '{{count}}d quiet', { count: item.days_since_activity })}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-500))]">
        {clientDrawer ? (
          <button
            id={`opportunity-board-client-${item.opportunity_id}`}
            type="button"
            className="text-[rgb(var(--color-primary-600))] hover:underline"
            onClick={() => clientDrawer.openClientDrawer(item.client_id)}
          >
            {item.client_name}
          </button>
        ) : (
          <Link href={`/msp/clients/${item.client_id}`} className="text-[rgb(var(--color-primary-600))] hover:underline">
            {item.client_name}
          </Link>
        )}
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
    </div>
  );
}
