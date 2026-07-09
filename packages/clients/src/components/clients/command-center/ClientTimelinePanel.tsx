'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { listClientTimeline } from '../../../actions/clientTimelineActions';
import type {
  ClientTimelineEvent,
  ClientTimelineEventType,
} from '../../../lib/commandCenterTypes';
import { CardShell } from './PulseCards';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type TFn = (key: string, options?: Record<string, unknown>) => string;

function isReturnedActionError(value: unknown): value is ActionMessageError | ActionPermissionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

interface ClientTimelinePanelProps {
  idPrefix: string;
  clientId: string;
  formatMoney: (cents: number) => string;
  onEventClick: (event: ClientTimelineEvent) => void;
  t: TFn;
}

type FilterKey = 'all' | 'service' | 'money' | 'inventory' | 'interactions';

const FILTER_TYPES: Record<Exclude<FilterKey, 'all'>, ClientTimelineEventType[]> = {
  service: ['ticket_opened', 'ticket_closed', 'material_added'],
  money: ['invoice_created', 'invoice_finalized', 'quote_activity'],
  inventory: ['unit_delivered', 'so_created', 'rma_opened', 'rma_closed'],
  interactions: ['interaction'],
};

const markerColor: Partial<Record<ClientTimelineEventType, string>> = {
  invoice_created: 'border-amber-300',
  invoice_finalized: 'border-amber-300',
  quote_activity: 'border-amber-300',
  unit_delivered: 'border-green-300',
  so_created: 'border-green-300',
  rma_opened: 'border-green-300',
  rma_closed: 'border-green-300',
};

function relativeTime(iso: string, t: TFn): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(deltaMs / 86_400_000);
  if (days <= 0) {
    const hours = Math.max(0, Math.floor(deltaMs / 3_600_000));
    return hours <= 0
      ? t('clientCommandCenter.timeline.justNow', { defaultValue: 'just now' })
      : t('clientCommandCenter.timeline.hoursAgo', { defaultValue: '{{count}}h ago', count: hours });
  }
  if (days < 30) return t('clientCommandCenter.timeline.daysAgo', { defaultValue: '{{count}}d ago', count: days });
  return new Date(iso).toLocaleDateString();
}

export default function ClientTimelinePanel({ idPrefix, clientId, formatMoney, onEventClick, t }: ClientTimelinePanelProps) {
  const [events, setEvents] = useState<ClientTimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (activeFilter: FilterKey, cursor: string | null) => {
    setIsLoading(true);
    setError(null);
    try {
      const page = await listClientTimeline(clientId, {
        cursor,
        types: activeFilter === 'all' ? undefined : FILTER_TYPES[activeFilter],
        limit: 20,
      });
      if (isReturnedActionError(page)) {
        setError(getErrorMessage(page));
        return;
      }
      setEvents((previous) => (cursor ? [...previous, ...page.events] : page.events));
      setNextCursor(page.nextCursor);
    } catch {
      setError(t('clientCommandCenter.timeline.error', { defaultValue: 'Could not load the timeline.' }));
    } finally {
      setIsLoading(false);
    }
  }, [clientId, t]);

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    void loadPage(filter, null);
  }, [filter, loadPage]);

  const typeLabel = (event: ClientTimelineEvent): string => {
    switch (event.type) {
      case 'ticket_opened':
        return t('clientCommandCenter.timeline.ticketOpened', { defaultValue: 'Ticket opened' });
      case 'ticket_closed':
        return t('clientCommandCenter.timeline.ticketClosed', { defaultValue: 'Ticket closed' });
      case 'material_added':
        return t('clientCommandCenter.timeline.materialAdded', { defaultValue: 'Material used' });
      case 'invoice_created':
        return t('clientCommandCenter.timeline.invoiceCreated', { defaultValue: 'Invoice drafted' });
      case 'invoice_finalized':
        return t('clientCommandCenter.timeline.invoiceFinalized', { defaultValue: 'Invoice finalized' });
      case 'unit_delivered':
        return t('clientCommandCenter.timeline.unitDelivered', { defaultValue: 'Equipment delivered' });
      case 'so_created':
        return t('clientCommandCenter.timeline.soCreated', { defaultValue: 'Sales order created' });
      case 'rma_opened':
        return t('clientCommandCenter.timeline.rmaOpened', { defaultValue: 'RMA opened' });
      case 'rma_closed':
        return t('clientCommandCenter.timeline.rmaClosed', { defaultValue: 'RMA closed' });
      case 'interaction':
        return t('clientCommandCenter.timeline.interaction', { defaultValue: 'Interaction' });
      case 'quote_activity':
        return t('clientCommandCenter.timeline.quoteActivity', { defaultValue: 'Quote activity' });
      default:
        return event.type;
    }
  };

  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: t('clientCommandCenter.timeline.filterAll', { defaultValue: 'All' }) },
    { key: 'service', label: t('clientCommandCenter.timeline.filterService', { defaultValue: 'Service' }) },
    { key: 'money', label: t('clientCommandCenter.timeline.filterMoney', { defaultValue: 'Money' }) },
    { key: 'inventory', label: t('clientCommandCenter.timeline.filterInventory', { defaultValue: 'Inventory' }) },
    { key: 'interactions', label: t('clientCommandCenter.timeline.filterInteractions', { defaultValue: 'Interactions' }) },
  ];

  return (
    <CardShell
      id={`${idPrefix}-timeline`}
      title={t('clientCommandCenter.cards.timeline', { defaultValue: 'Everything, in order' })}
      className="h-full flex flex-col"
    >
      <div className="flex flex-wrap gap-1 mb-3" data-print-hide>
        {filters.map((entry) => (
          <button
            key={entry.key}
            id={`${idPrefix}-timeline-filter-${entry.key}`}
            type="button"
            onClick={() => setFilter(entry.key)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              filter === entry.key
                ? 'bg-primary-100 text-primary-800'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {!error && events.length === 0 && !isLoading && (
        <p className="text-[13px] text-gray-400 italic">
          {t('clientCommandCenter.timeline.empty', { defaultValue: 'Nothing recorded yet for this client.' })}
        </p>
      )}

      <ul className="relative pl-5 flex-1 overflow-y-auto min-h-0">
        <span className="absolute left-[5px] top-1.5 bottom-1.5 w-0.5 bg-gray-100" aria-hidden />
        {events.map((event) => (
          <li key={event.id} className="relative pb-3.5 text-[13px]">
            <span
              className={`absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-white border-[3px] ${markerColor[event.type] ?? 'border-primary-200'}`}
              aria-hidden
            />
            <div className="text-gray-800 leading-snug">
              <span className="font-medium">{typeLabel(event)}</span>
              {' — '}
              <button
                type="button"
                onClick={() => onEventClick(event)}
                className="text-primary-700 font-semibold hover:underline"
              >
                {event.refLabel}
              </button>
              {event.summary ? <span className="text-gray-600"> · {event.summary}</span> : null}
              {event.amountCents != null ? <span className="text-gray-500"> · {formatMoney(event.amountCents)}</span> : null}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">{relativeTime(event.occurredAt, t)}</div>
          </li>
        ))}
      </ul>

      {isLoading && (
        <p className="text-[12px] text-gray-400 py-1">
          {t('clientCommandCenter.timeline.loading', { defaultValue: 'Loading…' })}
        </p>
      )}
      {nextCursor && !isLoading && (
        <button
          id={`${idPrefix}-timeline-load-more`}
          type="button"
          onClick={() => void loadPage(filter, nextCursor)}
          className="mt-1 text-xs font-semibold text-primary-600 hover:text-primary-800 self-start"
        >
          {t('clientCommandCenter.timeline.loadMore', { defaultValue: 'Load more' })}
        </button>
      )}
    </CardShell>
  );
}
