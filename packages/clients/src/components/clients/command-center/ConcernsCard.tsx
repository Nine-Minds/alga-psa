'use client';

import React from 'react';
import { BentoTile } from '@alga-psa/ui/components/bento/BentoTile';
import type { ClientAttentionFlag } from '../../../lib/commandCenterTypes';

interface ConcernsCardProps {
  id: string;
  flags: ClientAttentionFlag[];
  formatMoney: (cents: number) => string;
  onFlagClick: (flag: ClientAttentionFlag) => void;
  className?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const severityDot: Record<ClientAttentionFlag['severity'], string> = {
  amber: 'bg-amber-400',
  blue: 'bg-blue-400',
  gray: 'bg-gray-300',
};

/**
 * Cross-module exceptions grouped into one card (D8). Labels are built here
 * from structured server facts; the card renders nothing when there are no
 * flags — an empty "Concerns" card would be a placeholder.
 */
export default function ConcernsCard({ id, flags, formatMoney, onFlagClick, className = '', t }: ConcernsCardProps) {
  if (!flags.length) {
    return null;
  }

  const labelFor = (flag: ClientAttentionFlag): string => {
    switch (flag.kind) {
      case 'draft_invoices':
        return t('clientCommandCenter.flags.draftInvoices', {
          defaultValue_one: '⚠ 1 draft invoice — {{amount}} unbilled · {{ref}}',
          defaultValue_other: '⚠ {{count}} draft invoices — {{amount}} unbilled · {{ref}}',
          count: flag.count,
          amount: flag.amountCents != null ? formatMoney(flag.amountCents) : '',
          ref: flag.refLabel ?? '',
        });
      case 'so_partial':
        return t('clientCommandCenter.flags.soPartial', {
          defaultValue: '📦 {{ref}}: {{fulfilled}} of {{total}} lines fulfilled',
          ref: flag.refLabel ?? '',
          fulfilled: flag.linesFulfilled ?? 0,
          total: flag.linesTotal ?? 0,
        });
      case 'ticket_overdue':
        return t('clientCommandCenter.flags.ticketOverdue', {
          defaultValue_one: '⏰ 1 overdue ticket — {{ref}} {{days}}d past due',
          defaultValue_other: '⏰ {{count}} overdue tickets — {{ref}} {{days}}d past due',
          count: flag.count,
          ref: flag.refLabel ?? '',
          days: flag.daysAgo ?? 0,
        });
      case 'client_waiting':
        return t('clientCommandCenter.flags.clientWaiting', {
          defaultValue: '💬 Client waiting {{days}}d — {{ref}}',
          days: flag.daysAgo ?? 0,
          ref: flag.refLabel ?? '',
        });
      case 'rma_open':
        return t('clientCommandCenter.flags.rmaOpen', {
          defaultValue_one: '↩ 1 open RMA — {{days}}d',
          defaultValue_other: '↩ {{count}} open RMAs — oldest {{days}}d',
          count: flag.count,
          days: flag.daysAgo ?? 0,
        });
      // Ops-depth flags (W1-W3). SLA facts come from tickets.sla_* columns.
      case 'sla_breached':
        return t('clientCommandCenter.flags.slaBreached', {
          defaultValue_one: '⛔ SLA breached — {{ref}}',
          defaultValue_other: '⛔ {{count}} SLA breaches — worst {{ref}}',
          count: flag.count,
          ref: flag.refLabel ?? '',
        });
      case 'sla_at_risk':
        return t('clientCommandCenter.flags.slaAtRisk', {
          defaultValue_one: '⏳ SLA at risk — {{ref}}',
          defaultValue_other: '⏳ {{count}} tickets at SLA risk — next {{ref}}',
          count: flag.count,
          ref: flag.refLabel ?? '',
        });
      case 'ticket_unassigned':
        return t('clientCommandCenter.flags.ticketUnassigned', {
          defaultValue_one: '👤 1 unassigned ticket — {{ref}}',
          defaultValue_other: '👤 {{count}} unassigned tickets — oldest {{ref}}',
          count: flag.count,
          ref: flag.refLabel ?? '',
        });
      case 'wip_aging': {
        const materials = flag.amountCents ? ` · ${formatMoney(flag.amountCents)} materials` : '';
        return t('clientCommandCenter.flags.wipAging', {
          defaultValue_one: '⌛ 1 unbilled item — {{days}}d old{{materials}}',
          defaultValue_other: '⌛ {{count}} unbilled items — oldest {{days}}d{{materials}}',
          count: flag.count,
          days: flag.daysAgo ?? 0,
          materials,
        });
      }
      default:
        return '';
    }
  };

  return (
    <div data-print-hide className={`min-w-0 ${className}`}>
      <BentoTile
        id={id}
        title={t('clientCommandCenter.cards.concerns', { defaultValue: 'Concerns' })}
        action={
          <span className="rounded-full bg-amber-200/70 text-amber-900 px-1.5 text-[10.5px] font-bold leading-4">
            {flags.length}
          </span>
        }
        className="h-full"
        surfaceClassName="border-amber-200 bg-amber-50/50"
      >
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          {flags.map((flag, index) => (
            <li key={`${flag.kind}-${flag.refId ?? index}`} className="min-w-0">
              <button
                id={`${id}-flag-${flag.kind}-${index}`}
                type="button"
                onClick={() => onFlagClick(flag)}
                className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-gray-800 hover:bg-white/80 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${severityDot[flag.severity]}`} aria-hidden="true" />
                <span className="min-w-0 truncate">{labelFor(flag)}</span>
                <span className="ml-auto text-gray-400 shrink-0">→</span>
              </button>
            </li>
          ))}
        </ul>
      </BentoTile>
    </div>
  );
}
