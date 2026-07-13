'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityListItem, OpportunityStage } from '@alga-psa/types';
import { BoardCard } from './BoardCard';

const OPEN_COLUMNS: OpportunityStage[] = ['identified', 'qualified', 'assessment', 'proposed', 'verbal'];

const COLUMN_LABEL_KEYS: Record<string, [string, string]> = {
  identified: ['opportunities.stage.identified', 'Identified'],
  qualified: ['opportunities.stage.qualified', 'Qualified'],
  assessment: ['opportunities.stage.assessment', 'Assessment'],
  proposed: ['opportunities.stage.proposed', 'Proposed'],
  verbal: ['opportunities.stage.verbal', 'Verbal'],
  closed: ['opportunities.board.recentlyClosed', 'Recently closed'],
};

/**
 * The board view: stage columns whose cards move by evidence, not by hand.
 * The only permitted forward drag is onto Qualified (the declared checkpoint);
 * any card can be dragged to the closed rail to mark it lost (with a reason).
 * Everything else is read-only by design — evidence moves deals.
 */
export function OpportunityBoard({
  items,
  recentlyClosed,
  onOpen,
  onDeclareQualified,
  onMarkLost,
}: {
  items: IOpportunityListItem[];
  recentlyClosed: IOpportunityListItem[];
  onOpen: (opportunityId: string) => void;
  /** Dropping an Identified card on Qualified attests the declared checkpoint. */
  onDeclareQualified: (opportunityId: string) => void;
  /** Dropping any open card on the closed rail prompts the loss-reason dialog. */
  onMarkLost: (opportunityId: string) => void;
}) {
  const { t } = useTranslation();
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
    if (!dragging) return false;
    if (column === 'closed') return true;
    return column === 'qualified' && dragging.stage === 'identified';
  };

  const handleDrop = (column: string) => {
    if (!dragging || !canDropOn(column)) return;
    if (column === 'closed') onMarkLost(dragging.opportunity_id);
    else if (column === 'qualified') onDeclareQualified(dragging.opportunity_id);
    setDragging(null);
    setDropTarget(null);
  };

  const columnShell = (column: string, label: string, children: React.ReactNode, count: number) => (
    <div
      key={column}
      id={`opportunity-board-column-${column}`}
      className={`flex w-60 flex-none flex-col rounded-xl border p-2.5 transition-colors ${
        dropTarget === column && canDropOn(column)
          ? 'border-[rgb(var(--color-primary-400))] bg-[rgb(var(--color-primary-50))]'
          : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card-50,248_250_252))]'
      }`}
      onDragOver={(e) => {
        if (canDropOn(column)) {
          e.preventDefault();
          setDropTarget(column);
        }
      }}
      onDragLeave={() => setDropTarget((cur) => (cur === column ? null : cur))}
      onDrop={() => handleDrop(column)}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-500))]">
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-[rgb(var(--color-text-400))]">{count}</span>
      </div>
      <div className="min-h-16 flex-1 overflow-y-auto">{children}</div>
    </div>
  );

  return (
    <div id="opportunities-board" className="flex gap-3 overflow-x-auto pb-2">
      {OPEN_COLUMNS.map((stage) => {
        const [key, fallback] = COLUMN_LABEL_KEYS[stage];
        const columnItems = byStage.get(stage) ?? [];
        return columnShell(
          stage,
          t(key, fallback),
          columnItems.map((item) => (
            <BoardCard
              key={item.opportunity_id}
              item={item}
              onOpen={onOpen}
              draggable={item.stage === 'identified' || item.status === 'open'}
              onDragStart={(_e, dragged) => setDragging(dragged)}
            />
          )),
          columnItems.length
        );
      })}
      {columnShell(
        'closed',
        t(...COLUMN_LABEL_KEYS.closed as [string, string]),
        recentlyClosed.map((item) => (
          <div key={item.opportunity_id} className="opacity-70">
            <BoardCard item={item} onOpen={onOpen} />
          </div>
        )),
        recentlyClosed.length
      )}
    </div>
  );
}
