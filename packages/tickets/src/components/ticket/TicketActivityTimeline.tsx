'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Lock,
  Mail,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Paperclip,
  RefreshCcw,
  User2,
  Users,
} from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { ColumnDefinition } from '@alga-psa/types';
import type {
  TicketActivityRow,
  TicketTimelineEntry,
} from '@alga-psa/shared/lib/ticketActivity';

import { getTicketTimelineEntries } from '../../actions/ticketActivityActions';

interface TicketActivityTimelineProps {
  ticketId: string;
  /** Refresh trigger — bumping this value re-fetches the timeline. */
  refreshKey?: number;
}

interface FormattedEntry {
  key: string;
  occurredAt: string;
  icon: React.ReactElement;
  title: string;
  subtitle?: string;
  source: string;
  actor: string;
  rawActivity?: TicketActivityRow;
  // Indexable filter fields kept separately from the rendered cells.
  entryType: 'activity' | 'comment';
  eventType: string;
  actorType: string;
}

function actorLabel(activity: TicketActivityRow): string {
  if (activity.actor_display_name) return activity.actor_display_name;
  switch (activity.actor_type) {
    case 'user':
      return 'A user';
    case 'contact':
    case 'email_sender':
      return 'A contact';
    case 'api':
      return 'API client';
    case 'workflow':
      return 'Workflow';
    case 'system':
    default:
      return 'System';
  }
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'status_id':
      return 'status';
    case 'priority_id':
      return 'priority';
    case 'assigned_to':
      return 'assignee';
    case 'assigned_team_id':
      return 'team';
    case 'board_id':
      return 'board';
    case 'category_id':
      return 'category';
    case 'subcategory_id':
      return 'subcategory';
    case 'client_id':
      return 'client';
    case 'contact_name_id':
      return 'contact';
    case 'due_date':
      return 'due date';
    case 'response_state':
      return 'response state';
    case 'closed_at':
      return 'closed-at';
    case 'closed_by':
      return 'closed-by';
    case 'title':
      return 'title';
    case 'url':
      return 'URL';
    default:
      return field;
  }
}

function changeLine(field: string, change: { old?: unknown; new?: unknown; oldLabel?: string | null; newLabel?: string | null }): string {
  const oldVal = change.oldLabel ?? (change.old == null ? '∅' : String(change.old));
  const newVal = change.newLabel ?? (change.new == null ? '∅' : String(change.new));
  return `${fieldLabel(field)}: ${oldVal} → ${newVal}`;
}

function eventIcon(eventType: string): React.ReactElement {
  switch (eventType) {
    case 'TICKET_CREATED':
      return <PlayCircle className="h-4 w-4" />;
    case 'TICKET_CLOSED':
      return <CheckCircle className="h-4 w-4" />;
    case 'TICKET_REOPENED':
    case 'TICKET_BUNDLE_REOPENED':
      return <RefreshCcw className="h-4 w-4" />;
    case 'TICKET_STATUS_CHANGED':
      return <ArrowRightCircle className="h-4 w-4" />;
    case 'TICKET_PRIORITY_CHANGED':
      return <AlertTriangle className="h-4 w-4" />;
    case 'TICKET_ASSIGNED':
    case 'TICKET_UNASSIGNED':
      return <Users className="h-4 w-4" />;
    case 'TICKET_BOARD_MOVED':
      return <ArrowRightCircle className="h-4 w-4" />;
    case 'TICKET_RESPONSE_STATE_CHANGED':
      return <PauseCircle className="h-4 w-4" />;
    case 'TICKET_INTERNAL_NOTE_ADDED':
      return <Lock className="h-4 w-4" />;
    case 'TICKET_CUSTOMER_REPLIED':
    case 'TICKET_MESSAGE_ADDED':
    case 'TICKET_COMMENT_ADDED':
    case 'TICKET_COMMENT_UPDATED':
      return <MessageSquare className="h-4 w-4" />;
    case 'TICKET_DOCUMENT_ATTACHED':
    case 'TICKET_DOCUMENT_REMOVED':
      return <Paperclip className="h-4 w-4" />;
    case 'TICKET_INBOUND_EMAIL_RECEIVED':
      return <Mail className="h-4 w-4" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}

function describeActivity(activity: TicketActivityRow): { title: string; subtitle?: string } {
  const actor = actorLabel(activity);

  switch (activity.event_type) {
    case 'TICKET_CREATED':
      return { title: `${actor} created the ticket` };
    case 'TICKET_CLOSED':
      return { title: `${actor} closed the ticket` };
    case 'TICKET_REOPENED':
      return {
        title: `${actor} reopened the ticket`,
        subtitle:
          (activity.details as { reopen_trigger?: string })?.reopen_trigger === 'inbound_email_reply'
            ? 'Triggered by inbound email reply'
            : undefined,
      };
    case 'TICKET_BUNDLE_REOPENED':
      return {
        title: 'Bundle master reopened',
        subtitle: 'Triggered by a child-ticket reply',
      };
    case 'TICKET_STATUS_CHANGED': {
      const c = activity.changes?.status_id;
      const detail = c ? changeLine('status_id', c) : 'Status changed';
      return { title: `${actor} changed the status`, subtitle: detail };
    }
    case 'TICKET_PRIORITY_CHANGED': {
      const c = activity.changes?.priority_id;
      const detail = c ? changeLine('priority_id', c) : 'Priority changed';
      return { title: `${actor} changed the priority`, subtitle: detail };
    }
    case 'TICKET_ASSIGNED': {
      const c = activity.changes?.assigned_to;
      return {
        title: `${actor} assigned the ticket`,
        subtitle: c ? changeLine('assigned_to', c) : undefined,
      };
    }
    case 'TICKET_UNASSIGNED':
      return { title: `${actor} unassigned the ticket` };
    case 'TICKET_BOARD_MOVED': {
      const c = activity.changes?.board_id;
      return {
        title: `${actor} moved the ticket to another board`,
        subtitle: c ? changeLine('board_id', c) : undefined,
      };
    }
    case 'TICKET_RESPONSE_STATE_CHANGED': {
      const c = activity.changes?.response_state;
      return {
        title: `${actor} updated the response state`,
        subtitle: c ? changeLine('response_state', c) : undefined,
      };
    }
    case 'TICKET_INTERNAL_NOTE_ADDED':
      return { title: `${actor} added an internal note` };
    case 'TICKET_CUSTOMER_REPLIED':
      return {
        title: `${actor} replied`,
        subtitle:
          activity.source === 'inbound_email'
            ? 'Received via inbound email'
            : activity.source === 'client_portal'
              ? 'Received via client portal'
              : undefined,
      };
    case 'TICKET_MESSAGE_ADDED':
    case 'TICKET_COMMENT_ADDED':
      return { title: `${actor} added a comment` };
    case 'TICKET_COMMENT_UPDATED':
      return { title: `${actor} edited a comment` };
    case 'TICKET_DOCUMENT_ATTACHED': {
      const name = (activity.details as { document_name?: string })?.document_name;
      return {
        title: `${actor} attached a document`,
        subtitle: name ? name : undefined,
      };
    }
    case 'TICKET_DOCUMENT_REMOVED':
      return { title: `${actor} removed a document` };
    case 'TICKET_INBOUND_EMAIL_RECEIVED': {
      const subject = (activity.details as { email?: { subject?: string } })?.email?.subject;
      return {
        title: 'Inbound email received',
        subtitle: subject ?? undefined,
      };
    }
    case 'TICKET_UPDATED': {
      const fields = Object.keys(activity.changes ?? {});
      return {
        title: `${actor} updated the ticket`,
        subtitle: fields.length > 0 ? fields.map(fieldLabel).join(', ') : undefined,
      };
    }
    default:
      return { title: `${actor} • ${activity.event_type}` };
  }
}

function formatEntries(entries: TicketTimelineEntry[]): FormattedEntry[] {
  return entries.map((entry) => {
    if (entry.type === 'activity' && entry.activity) {
      const desc = describeActivity(entry.activity);
      return {
        key: `activity-${entry.sortId}`,
        occurredAt: entry.occurredAt,
        icon: eventIcon(entry.activity.event_type),
        title: desc.title,
        subtitle: desc.subtitle,
        source: entry.activity.source,
        actor: actorLabel(entry.activity),
        rawActivity: entry.activity,
        entryType: 'activity',
        eventType: entry.activity.event_type,
        actorType: entry.activity.actor_type,
      };
    }

    const c = entry.comment as Record<string, unknown> | undefined;
    const isInternal = !!c?.is_internal;
    const authorType = (c?.author_type as string) || 'unknown';
    const responseSource =
      (c?.metadata as { responseSource?: string } | null | undefined)?.responseSource ?? null;

    let title = 'Comment added';
    if (isInternal) title = 'Internal note added';
    else if (authorType === 'client' || authorType === 'contact' || responseSource === 'client_portal') {
      title = 'Customer reply';
    } else if (responseSource === 'inbound_email') {
      title = 'Inbound email reply';
    }

    return {
      key: `comment-${entry.sortId}`,
      occurredAt: entry.occurredAt,
      icon: isInternal ? <Lock className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />,
      title,
      subtitle: undefined,
      source: responseSource ?? (isInternal ? 'internal' : 'ui'),
      actor: 'See conversation tab',
      entryType: 'comment',
      eventType: isInternal ? 'TICKET_INTERNAL_NOTE_ADDED' : 'TICKET_COMMENT_ADDED',
      actorType: authorType === 'client' || authorType === 'contact' ? 'contact' : 'user',
    };
  });
}

function formatTimestamp(value: string): string {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

const ALL_FILTER_VALUE = '__all__';

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_FILTER_VALUE, label: 'All events' },
  { value: 'TICKET_CREATED', label: 'Ticket created' },
  { value: 'TICKET_UPDATED', label: 'Ticket updated' },
  { value: 'TICKET_STATUS_CHANGED', label: 'Status changed' },
  { value: 'TICKET_CLOSED', label: 'Closed' },
  { value: 'TICKET_REOPENED', label: 'Reopened' },
  { value: 'TICKET_PRIORITY_CHANGED', label: 'Priority changed' },
  { value: 'TICKET_ASSIGNED', label: 'Assigned' },
  { value: 'TICKET_UNASSIGNED', label: 'Unassigned' },
  { value: 'TICKET_BOARD_MOVED', label: 'Board moved' },
  { value: 'TICKET_RESPONSE_STATE_CHANGED', label: 'Response state' },
  { value: 'TICKET_MESSAGE_ADDED', label: 'Comment added' },
  { value: 'TICKET_COMMENT_ADDED', label: 'Comment added' },
  { value: 'TICKET_COMMENT_UPDATED', label: 'Comment edited' },
  { value: 'TICKET_INTERNAL_NOTE_ADDED', label: 'Internal note' },
  { value: 'TICKET_CUSTOMER_REPLIED', label: 'Customer reply' },
  { value: 'TICKET_DOCUMENT_ATTACHED', label: 'Document attached' },
  { value: 'TICKET_DOCUMENT_REMOVED', label: 'Document removed' },
  { value: 'TICKET_INBOUND_EMAIL_RECEIVED', label: 'Inbound email' },
  { value: 'TICKET_BUNDLE_REOPENED', label: 'Bundle reopened' },
];

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_FILTER_VALUE, label: 'All sources' },
  { value: 'ui', label: 'UI' },
  { value: 'api', label: 'API' },
  { value: 'client_portal', label: 'Client Portal' },
  { value: 'inbound_email', label: 'Inbound Email' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'system', label: 'System' },
  { value: 'internal', label: 'Internal Note' },
];

const ACTOR_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_FILTER_VALUE, label: 'All actors' },
  { value: 'user', label: 'User' },
  { value: 'contact', label: 'Contact' },
  { value: 'email_sender', label: 'Email sender' },
  { value: 'api', label: 'API client' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'system', label: 'System' },
];

const ENTRY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_FILTER_VALUE, label: 'All entries' },
  { value: 'activity', label: 'Activity only' },
  { value: 'comment', label: 'Comments only' },
];

function sourceBadge(source: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    ui: { label: 'UI', className: 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]' },
    api: { label: 'API', className: 'bg-[rgb(var(--color-secondary-50))] text-[rgb(var(--color-secondary-700))]' },
    client_portal: { label: 'Client Portal', className: 'bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
    inbound_email: { label: 'Inbound Email', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
    workflow: { label: 'Workflow', className: 'bg-purple-50 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' },
    system: { label: 'System', className: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]' },
    internal: { label: 'Internal Note', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
  };
  return (
    map[source] ?? {
      label: source,
      className: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]',
    }
  );
}

export function TicketActivityTimeline({ ticketId, refreshKey = 0 }: TicketActivityTimelineProps) {
  const { t: tCommon } = useTranslation('common');
  const [entries, setEntries] = useState<TicketTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>(ALL_FILTER_VALUE);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_FILTER_VALUE);
  const [actorTypeFilter, setActorTypeFilter] = useState<string>(ALL_FILTER_VALUE);
  const [entryTypeFilter, setEntryTypeFilter] = useState<string>(ALL_FILTER_VALUE);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTicketTimelineEntries(ticketId, { order: 'desc' })
      .then((rows) => {
        if (cancelled) return;
        if (isActionMessageError(rows) || isActionPermissionError(rows)) {
          setEntries([]);
          setError(getErrorMessage(rows));
          return;
        }
        setEntries(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load ticket activity timeline:', err);
        setError('Failed to load ticket activity timeline.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey]);

  // All hooks must run unconditionally on every render — keep useMemo/etc.
  // above the loading/error early returns to satisfy the rules of hooks.
  const formatted = useMemo(() => formatEntries(entries ?? []), [entries]);

  const filtered = useMemo(() => {
    return formatted.filter((entry) => {
      if (entryTypeFilter !== ALL_FILTER_VALUE && entry.entryType !== entryTypeFilter) return false;
      if (eventTypeFilter !== ALL_FILTER_VALUE && entry.eventType !== eventTypeFilter) return false;
      if (sourceFilter !== ALL_FILTER_VALUE && entry.source !== sourceFilter) return false;
      if (actorTypeFilter !== ALL_FILTER_VALUE && entry.actorType !== actorTypeFilter) return false;
      return true;
    });
  }, [formatted, entryTypeFilter, eventTypeFilter, sourceFilter, actorTypeFilter]);

  const selectedEntry = useMemo(
    () => filtered.find((e) => e.key === expandedKey) ?? null,
    [filtered, expandedKey],
  );

  const filtersDirty =
    entryTypeFilter !== ALL_FILTER_VALUE ||
    eventTypeFilter !== ALL_FILTER_VALUE ||
    sourceFilter !== ALL_FILTER_VALUE ||
    actorTypeFilter !== ALL_FILTER_VALUE;

  const resetFilters = () => {
    setEntryTypeFilter(ALL_FILTER_VALUE);
    setEventTypeFilter(ALL_FILTER_VALUE);
    setSourceFilter(ALL_FILTER_VALUE);
    setActorTypeFilter(ALL_FILTER_VALUE);
  };

  const columns: ColumnDefinition<FormattedEntry>[] = useMemo(
    () => [
      {
        title: 'When',
        dataIndex: 'occurredAt',
        width: '180px',
        render: (value: unknown) => (
          <time
            className="whitespace-nowrap text-xs text-[rgb(var(--color-text-700))]"
            dateTime={typeof value === 'string' ? value : undefined}
            title={typeof value === 'string' ? value : undefined}
          >
            {formatTimestamp(String(value))}
          </time>
        ),
      },
      {
        title: 'Event',
        dataIndex: 'title',
        render: (_value: unknown, record: FormattedEntry) => (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]">
              {record.icon}
            </span>
            <div className="min-w-0">
              <div className="font-medium text-[rgb(var(--color-text-900))]">{record.title}</div>
              {record.subtitle ? (
                <div className="text-xs text-[rgb(var(--color-text-700))]">{record.subtitle}</div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        title: 'Source',
        dataIndex: 'source',
        width: '140px',
        render: (value: unknown) => {
          const badge = sourceBadge(String(value ?? ''));
          return (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          );
        },
      },
      {
        title: 'Actor',
        dataIndex: 'actor',
        width: '180px',
        render: (value: unknown) => (
          <span className="inline-flex items-center gap-1 text-xs text-[rgb(var(--color-text-700))]">
            <User2 className="h-3 w-3" />
            {String(value ?? '')}
          </span>
        ),
      },
      {
        title: '',
        dataIndex: 'key',
        width: '120px',
        render: (_value: unknown, record: FormattedEntry) => {
          if (!record.rawActivity) return null;
          const isOpen = expandedKey === record.key;
          return (
            <Button
              id={`ticket-activity-entry-toggle-${record.key}`}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedKey(isOpen ? null : record.key);
              }}
            >
              {isOpen ? (
                <>
                  <ChevronDown className="mr-1 h-3 w-3" />
                  Hide
                </>
              ) : (
                <>
                  <ChevronRight className="mr-1 h-3 w-3" />
                  Details
                </>
              )}
            </Button>
          );
        },
      },
    ],
    [expandedKey],
  );

  const filterBar = (
    <div
      id="ticket-activity-timeline-filters"
      className="flex flex-wrap items-end gap-2 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-2"
    >
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-entry-type">
          Type
        </label>
        <CustomSelect
          id="ticket-activity-filter-entry-type"
          value={entryTypeFilter}
          options={ENTRY_TYPE_OPTIONS}
          onValueChange={setEntryTypeFilter}
        />
      </div>
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-event-type">
          Event
        </label>
        <CustomSelect
          id="ticket-activity-filter-event-type"
          value={eventTypeFilter}
          options={EVENT_TYPE_OPTIONS}
          onValueChange={setEventTypeFilter}
        />
      </div>
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-source">
          Source
        </label>
        <CustomSelect
          id="ticket-activity-filter-source"
          value={sourceFilter}
          options={SOURCE_OPTIONS}
          onValueChange={setSourceFilter}
        />
      </div>
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-actor-type">
          Actor
        </label>
        <CustomSelect
          id="ticket-activity-filter-actor-type"
          value={actorTypeFilter}
          options={ACTOR_TYPE_OPTIONS}
          onValueChange={setActorTypeFilter}
        />
      </div>
      <div className="ml-auto flex items-end">
        <Button
          id="ticket-activity-filter-reset"
          variant="ghost"
          size="sm"
          className="h-9 px-3 text-xs"
          disabled={!filtersDirty}
          onClick={resetFilters}
        >
          Reset filters
        </Button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div id="ticket-activity-timeline-loading" className="p-4 text-sm text-[rgb(var(--color-text-500))]">
        {tCommon('status.loading', { defaultValue: 'Loading...' })}
      </div>
    );
  }

  if (error) {
    return (
      <div id="ticket-activity-timeline-error" className="p-4 text-sm text-red-600 dark:text-red-400">
        Failed to load activity timeline: {error}
      </div>
    );
  }

  if (!formatted.length) {
    // Graceful empty state — tickets created before this feature have no
    // activity rows yet (no historical backfill, see PRD NFR-06/NFR-07).
    return (
      <div className="flex h-full flex-col">
        {filterBar}
        <div
          id="ticket-activity-timeline-empty"
          className="p-4 text-sm text-[rgb(var(--color-text-500))]"
        >
          No activity yet. New events will appear here as the ticket changes.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {filterBar}
      <div className="flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div
            id="ticket-activity-timeline-no-matches"
            className="p-3 text-sm text-[rgb(var(--color-text-500))]"
          >
            No entries match the current filters.
          </div>
        ) : (
          <div id="ticket-activity-timeline" data-row-count={filtered.length}>
            <DataTable<FormattedEntry>
              id="ticket-activity-timeline-table"
              data={filtered}
              columns={columns}
              pagination={filtered.length > 25}
              pageSize={25}
            />
          </div>
        )}
        {selectedEntry?.rawActivity ? (
          <div
            id={`ticket-activity-entry-details-${selectedEntry.key}`}
            className="mt-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-2"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                {selectedEntry.rawActivity.event_type}
              </span>
              <Button
                id="ticket-activity-entry-details-close"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setExpandedKey(null)}
              >
                Close
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto text-xs text-[rgb(var(--color-text-700))]">
{JSON.stringify(
  {
    event_type: selectedEntry.rawActivity.event_type,
    actor_type: selectedEntry.rawActivity.actor_type,
    source: selectedEntry.rawActivity.source,
    changes: selectedEntry.rawActivity.changes,
    details: selectedEntry.rawActivity.details,
  },
  null,
  2,
)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default TicketActivityTimeline;
