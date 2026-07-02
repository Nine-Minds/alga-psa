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
          defaultValue: '⚠ {{count}} draft invoice(s) — {{amount}} unbilled · {{ref}}',
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
          defaultValue: '⏰ {{count}} overdue ticket(s) — {{ref}} {{days}}d past due',
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
          defaultValue: '↩ {{count}} open RMA(s) — oldest {{days}}d',
          count: flag.count,
          days: flag.daysAgo ?? 0,
        });
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
