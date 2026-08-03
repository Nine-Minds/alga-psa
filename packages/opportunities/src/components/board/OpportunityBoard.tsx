'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { IOpportunityListItem, OpportunityStage } from '@alga-psa/types';
import { BoardCard } from './BoardCard';
import { OPEN_OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS } from '../../lib/opportunityStages';
import { oneTimeCents } from '../../lib/pipelineReporting';

const OPEN_COLUMNS: OpportunityStage[] = [...OPEN_OPPORTUNITY_STAGES];

type OpenStage = typeof OPEN_OPPORTUNITY_STAGES[number];

function isOpenStage(column: string): column is OpenStage {
  return (OPEN_COLUMNS as string[]).includes(column);
}

/**
 * The board view: stage columns. Dropping a card on a column attests that
 * checkpoint by hand — the same declared-evidence path the detail page's
 * Evidence ladder uses, so what you can click you can also drag. Dropping on
 * the closed rail marks the deal lost (with a reason).
 */
export function OpportunityBoard({
  items,
  recentlyClosed,
  onOpen,
  onDeclareStage,
  onMarkLost,
}: {
  items: IOpportunityListItem[];
  recentlyClosed: IOpportunityListItem[];
  onOpen: (opportunityId: string) => void;
  /** Dropping an open card on a stage column attests that declared checkpoint. */
  onDeclareStage: (opportunityId: string, stage: OpenStage) => void;
  /** Dropping any open card on the closed rail prompts the loss-reason dialog. */
  onMarkLost: (opportunityId: string) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [dragging, setDragging] = useState<IOpportunityListItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<OpportunityStage, IOpportunityListItem[]>();
    OPEN_COLUMNS.forEach((s) => map.set(s, []));
    items.forEach((item) => {
      if (map.has(item.stage)) map.get(item.stage)!.push(item);
    });
    return map;
  }, [items]);

  const canDropOn = (column: string): boolean => {
    if (!dragging || dragging.status !== 'open') return false;
    if (column === 'closed') return true;
    return isOpenStage(column) && column !== dragging.stage;
  };

  const handleDrop = (column: string) => {
    if (!dragging || !canDropOn(column)) {
      setDropTarget(null);
      return;
    }
    if (column === 'closed') onMarkLost(dragging.opportunity_id);
    else if (isOpenStage(column)) onDeclareStage(dragging.opportunity_id, column);
    setDragging(null);
    setDropTarget(null);
  };

  const columnShell = (
    column: string,
    label: string,
    children: React.ReactNode,
    columnItems: IOpportunityListItem[],
  ) => {
    const droppable = canDropOn(column);
    const blocked = dragging != null && !droppable;
    return (
      <div
        key={column}
        id={`opportunity-board-column-${column}`}
        className={`flex w-60 flex-none flex-col rounded-xl border p-2.5 transition-colors ${
          dropTarget === column && droppable
            ? 'border-[rgb(var(--color-primary-400))] bg-[rgb(var(--color-primary-50))]'
            : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card-50,248_250_252))]'
        } ${blocked ? 'cursor-not-allowed opacity-60' : ''}`}
        onDragOver={(e) => {
          if (droppable) {
            e.preventDefault();
            setDropTarget(column);
          }
        }}
        onDragLeave={() => setDropTarget((cur) => (cur === column ? null : cur))}
        onDrop={() => handleDrop(column)}
      >
        <div className="mb-2 px-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-500))]">
              {label}
            </span>
            <span className="text-[11px] tabular-nums text-[rgb(var(--color-text-400))]">{columnItems.length}</span>
          </div>
          <ColumnSubtotal id={`opportunity-board-subtotal-${column}`} items={columnItems} />
        </div>
        <div className="min-h-16 flex-1 overflow-y-auto">{children}</div>
      </div>
    );
  };

  return (
    <div id="opportunities-board" className="flex gap-3 overflow-x-auto pb-2">
      {OPEN_COLUMNS.map((stage) => {
        const label = OPPORTUNITY_STAGE_LABELS[stage];
        const columnItems = byStage.get(stage) ?? [];
        return columnShell(
          stage,
          t(label.key, label.fallback),
          columnItems.map((item) => (
            <BoardCard
              key={item.opportunity_id}
              item={item}
              onOpen={onOpen}
              draggable={item.status === 'open'}
              onDragStart={(_e, dragged) => setDragging(dragged)}
            />
          )),
          columnItems
        );
      })}
      {columnShell(
        'closed',
        t('opportunities.board.recentlyClosed', 'Recently closed'),
        recentlyClosed.map((item) => (
          <div key={item.opportunity_id} className="opacity-70">
            <BoardCard item={item} onOpen={onOpen} />
          </div>
        )),
        recentlyClosed
      )}
    </div>
  );
}

/** What a stage is worth, so the board answers the money question without a round trip. */
function ColumnSubtotal({ id, items }: { id: string; items: IOpportunityListItem[] }) {
  const { t } = useTranslation('msp/opportunities');
  const totals = useMemo(() => {
    const map = new Map<string, { mrr: number; oneTime: number }>();
    for (const item of items) {
      const current = map.get(item.currency_code) ?? { mrr: 0, oneTime: 0 };
      current.mrr += item.mrr_cents;
      current.oneTime += oneTimeCents(item);
      map.set(item.currency_code, current);
    }
    return [...map.entries()];
  }, [items]);

  if (totals.length === 0) return null;

  return (
    <div id={id} className="mt-0.5 space-y-0.5">
      {totals.map(([currency, total]) => (
        <p key={currency} className="text-[11px] tabular-nums text-[rgb(var(--color-text-500))]">
          {formatCurrencyFromMinorUnits(total.mrr, undefined, currency)}
          {t('opportunities.perMonthSuffix', '/mo')}
          {total.oneTime > 0
            ? ` · ${formatCurrencyFromMinorUnits(total.oneTime, undefined, currency)}`
            : ''}
        </p>
      ))}
    </div>
  );
}
