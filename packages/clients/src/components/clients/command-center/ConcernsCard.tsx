'use client';

import React from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronRight,
  Clock,
  Hourglass,
  MessageSquare,
  Package,
  Timer,
  Undo2,
  User,
  type LucideIcon,
} from 'lucide-react';
import { BentoTile } from '@alga-psa/ui/components/bento';
import type { ClientAttentionFlag } from '../../../lib/commandCenterTypes';

interface ConcernsCardProps {
  id: string;
  flags: ClientAttentionFlag[];
  formatMoney: (cents: number) => string;
  onFlagClick: (flag: ClientAttentionFlag) => void;
  className?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

// The glyphs that used to be baked into each label string. severityDot
// already carries urgency, so these say only "what kind of thing is this".
const flagIcon: Record<ClientAttentionFlag['kind'], LucideIcon> = {
  draft_invoices: AlertTriangle,
  so_partial: Package,
  ticket_overdue: Clock,
  client_waiting: MessageSquare,
  rma_open: Undo2,
  sla_breached: Ban,
  sla_at_risk: Hourglass,
  ticket_unassigned: User,
  wip_aging: Timer,
};

const severityDot: Record<ClientAttentionFlag['severity'], string> = {
  amber: 'bg-amber-400',
  blue: 'bg-blue-400',
  gray: 'bg-[rgb(var(--color-text-300))]',
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
          defaultValue_one: '1 draft invoice — {{amount}} unbilled · {{ref}}',
          defaultValue_other: '{{count}} draft invoices — {{amount}} unbilled · {{ref}}',
          count: flag.count,
          amount: flag.amountCents != null ? formatMoney(flag.amountCents) : '',
          ref: flag.refLabel ?? '',
        });
      case 'so_partial':
        return t('clientCommandCenter.flags.soPartial', {
          defaultValue: '{{ref}}: {{fulfilled}} of {{total}} lines fulfilled',
          ref: flag.refLabel ?? '',
          fulfilled: flag.linesFulfilled ?? 0,
          total: flag.linesTotal ?? 0,
        });
      case 'ticket_overdue':
        return t('clientCommandCenter.flags.ticketOverdue', {
          defaultValue_one: '1 overdue ticket — {{ref}} {{days}}d past due',
          defaultValue_other: '{{count}} overdue tickets — {{ref}} {{days}}d past due',
          count: flag.count,
          ref: flag.refLabel ?? '',
          days: flag.daysAgo ?? 0,
        });
      case 'client_waiting':
        return t('clientCommandCenter.flags.clientWaiting', {
          defaultValue: 'Client waiting {{days}}d — {{ref}}',
          days: flag.daysAgo ?? 0,
          ref: flag.refLabel ?? '',
        });
      case 'rma_open':
        return t('clientCommandCenter.flags.rmaOpen', {
          defaultValue_one: '1 open RMA — {{days}}d',
          defaultValue_other: '{{count}} open RMAs — oldest {{days}}d',
          count: flag.count,
          days: flag.daysAgo ?? 0,
        });
      // Ops-depth flags (W1-W3). SLA facts come from tickets.sla_* columns.
      case 'sla_breached':
        return t('clientCommandCenter.flags.slaBreached', {
          defaultValue_one: 'SLA breached — {{ref}}',
          defaultValue_other: '{{count}} SLA breaches — worst {{ref}}',
          count: flag.count,
          ref: flag.refLabel ?? '',
        });
      case 'sla_at_risk':
        return t('clientCommandCenter.flags.slaAtRisk', {
          defaultValue_one: 'SLA at risk — {{ref}}',
          defaultValue_other: '{{count}} tickets at SLA risk — next {{ref}}',
          count: flag.count,
          ref: flag.refLabel ?? '',
        });
      case 'ticket_unassigned':
        return t('clientCommandCenter.flags.ticketUnassigned', {
          defaultValue_one: '1 unassigned ticket — {{ref}}',
          defaultValue_other: '{{count}} unassigned tickets — oldest {{ref}}',
          count: flag.count,
          ref: flag.refLabel ?? '',
        });
      case 'wip_aging': {
        const materials = flag.amountCents ? ` · ${formatMoney(flag.amountCents)} materials` : '';
        return t('clientCommandCenter.flags.wipAging', {
          defaultValue_one: '1 unbilled item — {{days}}d old{{materials}}',
          defaultValue_other: '{{count}} unbilled items — oldest {{days}}d{{materials}}',
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
          <span className="rounded-full bg-amber-200/70 dark:bg-amber-400/25 text-amber-900 dark:text-amber-200 px-2 py-0.5 text-[10px] font-semibold leading-4">
            {flags.length}
          </span>
        }
        className="h-full"
        // Amber alert surface. The dark pair is explicit: the globals.css shim
        // only rewrites gray/white utilities, so an amber-50 tile would stay
        // light in dark mode and swallow its own text.
        surfaceClassName="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/20"
      >
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          {flags.map((flag, index) => {
            const FlagIcon = flagIcon[flag.kind];
            return (
            <li key={`${flag.kind}-${flag.refId ?? index}`} className="min-w-0">
              <button
                id={`${id}-flag-${flag.kind}-${index}`}
                type="button"
                onClick={() => onFlagClick(flag)}
                className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-[rgb(var(--color-text-800))] hover:bg-[rgb(var(--color-card)/0.8)] transition-colors"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${severityDot[flag.severity]}`} aria-hidden="true" />
                {FlagIcon ? <FlagIcon className="w-3.5 h-3.5 shrink-0 text-[rgb(var(--color-text-500))]" aria-hidden="true" /> : null}
                <span className="min-w-0 truncate">{labelFor(flag)}</span>
                <ChevronRight className="ml-auto w-4 h-4 shrink-0 text-[rgb(var(--color-text-400))]" aria-hidden="true" />
              </button>
            </li>
            );
          })}
        </ul>
      </BentoTile>
    </div>
  );
}
