'use client';

import React from 'react';
import type { ClientAttentionFlag } from '../../../lib/commandCenterTypes';

interface AttentionStripProps {
  idPrefix: string;
  flags: ClientAttentionFlag[];
  formatMoney: (cents: number) => string;
  onFlagClick: (flag: ClientAttentionFlag) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const severityClasses: Record<ClientAttentionFlag['severity'], string> = {
  amber: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  blue: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
  gray: 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50',
};

/**
 * Cross-module exceptions, one pill per flag (D8). Labels are built here from
 * structured server facts; the strip renders nothing when there are no flags.
 */
export default function AttentionStrip({ idPrefix, flags, formatMoney, onFlagClick, t }: AttentionStripProps) {
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
    <div id={`${idPrefix}-attention-strip`} className="flex flex-wrap gap-2 mb-4" data-print-hide>
      {flags.map((flag, index) => (
        <button
          key={`${flag.kind}-${flag.refId ?? index}`}
          id={`${idPrefix}-flag-${flag.kind}-${index}`}
          type="button"
          onClick={() => onFlagClick(flag)}
          className={`rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${severityClasses[flag.severity]}`}
        >
          {labelFor(flag)} <span className="opacity-60">→</span>
        </button>
      ))}
    </div>
  );
}
