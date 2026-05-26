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
  const [entries, setEntries] = useState<TicketTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTicketTimelineEntries(ticketId, { order: 'desc' })
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey]);

  const formatted = useMemo(() => formatEntries(entries ?? []), [entries]);

  if (loading) {
    return (
      <div id="ticket-activity-timeline-loading" className="p-4 text-sm text-[rgb(var(--color-text-500))]">
        Loading timeline…
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
      <div
        id="ticket-activity-timeline-empty"
        className="p-4 text-sm text-[rgb(var(--color-text-500))]"
      >
        No activity yet. New events will appear here as the ticket changes.
      </div>
    );
  }

  return (
    <ol id="ticket-activity-timeline" className="space-y-3 p-2">
      {formatted.map((entry) => {
        const badge = sourceBadge(entry.source);
        const isExpanded = expandedKey === entry.key;
        const expandable = !!entry.rawActivity;
        return (
          <li
            key={entry.key}
            id={`ticket-activity-entry-${entry.key}`}
            data-event-type={entry.rawActivity?.event_type}
            className="flex gap-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]">
              {entry.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <div className="font-medium text-[rgb(var(--color-text-900))]">{entry.title}</div>
                <time
                  className="text-xs text-[rgb(var(--color-text-500))]"
                  dateTime={entry.occurredAt}
                  title={entry.occurredAt}
                >
                  {formatTimestamp(entry.occurredAt)}
                </time>
              </div>
              {entry.subtitle ? (
                <div className="mt-0.5 text-sm text-[rgb(var(--color-text-700))]">{entry.subtitle}</div>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-[rgb(var(--color-text-500))]">
                  <User2 className="h-3 w-3" />
                  {entry.actor}
                </span>
                {expandable && entry.rawActivity ? (
                  <Button
                    id={`ticket-activity-entry-toggle-${entry.key}`}
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-xs"
                    onClick={() => setExpandedKey(isExpanded ? null : entry.key)}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronDown className="mr-1 h-3 w-3" />
                        Hide details
                      </>
                    ) : (
                      <>
                        <ChevronRight className="mr-1 h-3 w-3" />
                        Show details
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
              {isExpanded && entry.rawActivity ? (
                <pre
                  id={`ticket-activity-entry-details-${entry.key}`}
                  className="mt-2 max-h-48 overflow-auto rounded-md bg-[rgb(var(--color-border-50))] p-2 text-xs text-[rgb(var(--color-text-700))]"
                >
{JSON.stringify(
  {
    event_type: entry.rawActivity.event_type,
    actor_type: entry.rawActivity.actor_type,
    source: entry.rawActivity.source,
    changes: entry.rawActivity.changes,
    details: entry.rawActivity.details,
  },
  null,
  2,
)}
                </pre>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default TicketActivityTimeline;
