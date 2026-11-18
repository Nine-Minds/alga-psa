'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  LayoutTemplate,
  Link2,
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
import { ViaPrincipalLabel } from '@enterprise/components/service-principals/ViaPrincipalLabel';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation, useFormatters, translate } from '@alga-psa/ui/lib/i18n/client';
import { interpolateFallback } from '@alga-psa/ui/lib/i18n/interpolateFallback';
import { ticketActivityAttribution } from '../../lib/ticketActivityAttribution';
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

import { useTicketDataSource } from './TicketDataSourceContext';

interface TicketActivityTimelineProps {
  ticketId: string;
  /** Refresh trigger — bumping this value re-fetches the timeline. */
  refreshKey?: number;
}

const TIMELINE_NS = 'features/tickets';

/** The slice of i18next's `t` the timeline formatters need. */
type TimelineT = (key: string, options: Record<string, unknown> & { defaultValue: string }) => string;

// formatEntries is exported and runs outside a React tree (unit tests, shared
// formatting callers), so it falls back to the module-level i18next instance and
// fills interpolations by hand when no namespace has loaded yet.
const fallbackT: TimelineT = (key, options) =>
  interpolateFallback(
    translate(TIMELINE_NS, key, options),
    options as Record<string, string | number | null | undefined>,
  );

interface FormattedEntry {
  key: string;
  occurredAt: string;
  icon: React.ReactElement;
  title: string;
  annotation?: string;
  subtitle?: string;
  source: string;
  actor: string;
  rawActivity?: TicketActivityRow;
  // Indexable filter fields kept separately from the rendered cells.
  entryType: 'activity' | 'comment';
  eventType: string;
  actorType: string;
}

function actorLabel(activity: TicketActivityRow, t: TimelineT): string {
  const snapshot = ticketActivityAttribution(activity);
  if (snapshot) return snapshot;
  switch (activity.actor_type) {
    case 'user':
      return t('activityTimeline.actor.user', { defaultValue: 'A user' });
    case 'contact':
    case 'email_sender':
      return t('activityTimeline.actor.contact', { defaultValue: 'A contact' });
    case 'api':
      return t('activityTimeline.actor.apiClient', { defaultValue: 'API client' });
    case 'workflow':
      return t('activityTimeline.actor.workflow', { defaultValue: 'Workflow' });
    case 'system':
    default:
      return t('activityTimeline.actor.system', { defaultValue: 'System' });
  }
}

function fieldLabel(field: string, t: TimelineT): string {
  switch (field) {
    case 'status_id':
      return t('activityTimeline.fields.status', { defaultValue: 'status' });
    case 'priority_id':
      return t('activityTimeline.fields.priority', { defaultValue: 'priority' });
    case 'assigned_to':
      return t('activityTimeline.fields.assignee', { defaultValue: 'assignee' });
    case 'assigned_team_id':
      return t('activityTimeline.fields.team', { defaultValue: 'team' });
    case 'board_id':
      return t('activityTimeline.fields.board', { defaultValue: 'board' });
    case 'category_id':
      return t('activityTimeline.fields.category', { defaultValue: 'category' });
    case 'subcategory_id':
      return t('activityTimeline.fields.subcategory', { defaultValue: 'subcategory' });
    case 'client_id':
      return t('activityTimeline.fields.client', { defaultValue: 'client' });
    case 'contact_name_id':
      return t('activityTimeline.fields.contact', { defaultValue: 'contact' });
    case 'due_date':
      return t('activityTimeline.fields.dueDate', { defaultValue: 'due date' });
    case 'response_state':
      return t('activityTimeline.fields.responseState', { defaultValue: 'response state' });
    case 'closed_at':
      return t('activityTimeline.fields.closedAt', { defaultValue: 'closed-at' });
    case 'closed_by':
      return t('activityTimeline.fields.closedBy', { defaultValue: 'closed-by' });
    case 'title':
      return t('activityTimeline.fields.title', { defaultValue: 'title' });
    case 'url':
      return t('activityTimeline.fields.url', { defaultValue: 'URL' });
    default:
      return field;
  }
}

function changeLine(field: string, change: { old?: unknown; new?: unknown; oldLabel?: string | null; newLabel?: string | null }, t: TimelineT): string {
  const oldVal = change.oldLabel ?? (change.old == null ? '∅' : String(change.old));
  const newVal = change.newLabel ?? (change.new == null ? '∅' : String(change.new));
  return `${fieldLabel(field, t)}: ${oldVal} → ${newVal}`;
}

function eventIcon(eventType: string): React.ReactElement {
  switch (eventType) {
    case 'TICKET_CREATED':
      return <PlayCircle className="h-4 w-4" />;
    case 'TICKET_DUPLICATED_FROM':
    case 'TICKET_DUPLICATED_TO':
      return <Copy className="h-4 w-4" />;
    case 'TICKET_CREATED_FROM_TEMPLATE':
      return <LayoutTemplate className="h-4 w-4" />;
    case 'TICKET_CLOSED':
      return <CheckCircle className="h-4 w-4" />;
    case 'TICKET_REOPENED':
    case 'TICKET_BUNDLE_REOPENED':
    case 'TICKET_BUNDLE_STATUS_PROPAGATED':
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
    case 'TICKET_EXTERNAL_LINK_ADDED':
    case 'TICKET_EXTERNAL_LINK_UPDATED':
    case 'TICKET_EXTERNAL_LINK_REMOVED':
      return <Link2 className="h-4 w-4" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}

function externalLinkReference(activity: TicketActivityRow, t: TimelineT): string {
  const details = (activity.details ?? {}) as {
    system?: string;
    system_label?: string;
    external_id?: string;
  };
  const system = details.system_label ?? details.system ?? t('activityTimeline.externalSystemFallback', { defaultValue: 'an external system' });
  return details.external_id ? `${system} #${details.external_id}` : system;
}

function notificationSuppressionAnnotation(activity: TicketActivityRow, t: TimelineT): string | undefined {
  const suppression = (activity.details as {
    notification_suppression?: {
      suppress_contact_notifications?: unknown;
      suppress_internal_notifications?: unknown;
    };
  }).notification_suppression;

  if (suppression?.suppress_internal_notifications === true) {
    return t('activityTimeline.annotation.silentAll', { defaultValue: 'silent — no notifications' });
  }

  if (suppression?.suppress_contact_notifications === true) {
    return t('activityTimeline.annotation.silentContact', { defaultValue: 'silent — contact not notified' });
  }

  return undefined;
}

function describeActivity(
  activity: TicketActivityRow,
  visibilityLabel: (visible: boolean) => string,
  t: TimelineT,
): { title: string; annotation?: string; subtitle?: string } {
  const actor = actorLabel(activity, t);
  const annotation = notificationSuppressionAnnotation(activity, t);

  switch (activity.event_type) {
    case 'TICKET_CREATED':
      return { title: t('activityTimeline.events.created', { defaultValue: '{{actor}} created the ticket', actor }) };
    case 'TICKET_CREATED_FROM_TEMPLATE': {
      // The name is a snapshot taken at creation, so it survives the template being renamed or deleted.
      const details = (activity.details ?? {}) as { template_name?: string };
      return {
        title: details.template_name
          ? t('activityTimeline.events.createdFromTemplateNamed', { defaultValue: '{{actor}} created this ticket from template "{{templateName}}"', actor, templateName: details.template_name })
          : t('activityTimeline.events.createdFromTemplate', { defaultValue: '{{actor}} created this ticket from a template', actor }),
      };
    }
    case 'TICKET_DUPLICATED_FROM': {
      const details = (activity.details ?? {}) as { source_ticket_number?: string };
      return {
        title: details.source_ticket_number
          ? t('activityTimeline.events.duplicatedFromNumber', { defaultValue: '{{actor}} created this ticket as a duplicate of #{{ticketNumber}}', actor, ticketNumber: details.source_ticket_number })
          : t('activityTimeline.events.duplicatedFrom', { defaultValue: '{{actor}} created this ticket as a duplicate of another ticket', actor }),
      };
    }
    case 'TICKET_DUPLICATED_TO': {
      const details = (activity.details ?? {}) as { duplicate_ticket_number?: string };
      return {
        title: details.duplicate_ticket_number
          ? t('activityTimeline.events.duplicatedToNumber', { defaultValue: '{{actor}} duplicated this ticket as #{{ticketNumber}}', actor, ticketNumber: details.duplicate_ticket_number })
          : t('activityTimeline.events.duplicatedTo', { defaultValue: '{{actor}} duplicated this ticket', actor }),
      };
    }
    case 'TICKET_CLOSED':
      return { title: t('activityTimeline.events.closed', { defaultValue: '{{actor}} closed the ticket', actor }), annotation };
    case 'TICKET_REOPENED':
      return {
        title: t('activityTimeline.events.reopened', { defaultValue: '{{actor}} reopened the ticket', actor }),
        subtitle:
          (activity.details as { reopen_trigger?: string })?.reopen_trigger === 'inbound_email_reply'
            ? t('activityTimeline.events.reopenedByEmail', { defaultValue: 'Triggered by inbound email reply' })
            : undefined,
      };
    case 'TICKET_BUNDLE_REOPENED':
      return {
        title: t('activityTimeline.events.bundleReopened', { defaultValue: 'Bundle master reopened' }),
        subtitle: t('activityTimeline.events.bundleReopenedSubtitle', { defaultValue: 'Triggered by a child-ticket reply' }),
      };
    case 'TICKET_BUNDLE_STATUS_PROPAGATED': {
      const details = (activity.details ?? {}) as {
        action?: string;
        propagated?: boolean;
        child_ticket_ids?: string[];
      };
      if (details.propagated === false) {
        return { title: t('activityTimeline.events.bundleStatusNotPropagated', { defaultValue: '{{actor}} changed the bundle master status (children not updated)', actor }) };
      }
      const count = details.child_ticket_ids?.length ?? 0;
      const action = details.action === 'reopen'
        ? t('activityTimeline.events.bundleAction.reopened', { defaultValue: 'reopened' })
        : t('activityTimeline.events.bundleAction.closed', { defaultValue: 'closed' });
      return { title: t('activityTimeline.events.bundleStatusPropagated', { defaultValue: '{{actor}} {{action}} the bundle master and {{count}} child ticket(s)', actor, action, count }) };
    }
    case 'TICKET_STATUS_CHANGED': {
      const c = activity.changes?.status_id;
      const detail = c ? changeLine('status_id', c, t) : t('activityTimeline.events.statusChangedSubtitle', { defaultValue: 'Status changed' });
      return { title: t('activityTimeline.events.statusChanged', { defaultValue: '{{actor}} changed the status', actor }), annotation, subtitle: detail };
    }
    case 'TICKET_PRIORITY_CHANGED': {
      const c = activity.changes?.priority_id;
      const detail = c ? changeLine('priority_id', c, t) : t('activityTimeline.events.priorityChangedSubtitle', { defaultValue: 'Priority changed' });
      return { title: t('activityTimeline.events.priorityChanged', { defaultValue: '{{actor}} changed the priority', actor }), annotation, subtitle: detail };
    }
    case 'TICKET_ASSIGNED': {
      const c = activity.changes?.assigned_to;
      return {
        title: t('activityTimeline.events.assigned', { defaultValue: '{{actor}} assigned the ticket', actor }),
        annotation,
        subtitle: c ? changeLine('assigned_to', c, t) : undefined,
      };
    }
    case 'TICKET_UNASSIGNED':
      return { title: t('activityTimeline.events.unassigned', { defaultValue: '{{actor}} unassigned the ticket', actor }) };
    case 'TICKET_BOARD_MOVED': {
      const c = activity.changes?.board_id;
      return {
        title: t('activityTimeline.events.boardMoved', { defaultValue: '{{actor}} moved the ticket to another board', actor }),
        annotation,
        subtitle: c ? changeLine('board_id', c, t) : undefined,
      };
    }
    case 'TICKET_RESPONSE_STATE_CHANGED': {
      const c = activity.changes?.response_state;
      return {
        title: t('activityTimeline.events.responseStateUpdated', { defaultValue: '{{actor}} updated the response state', actor }),
        annotation,
        subtitle: c ? changeLine('response_state', c, t) : undefined,
      };
    }
    case 'TICKET_INTERNAL_NOTE_ADDED':
      return { title: t('activityTimeline.events.internalNoteAdded', { defaultValue: '{{actor}} added an internal note', actor }) };
    case 'TICKET_CUSTOMER_REPLIED':
      return {
        title: t('activityTimeline.events.replied', { defaultValue: '{{actor}} replied', actor }),
        subtitle:
          activity.source === 'inbound_email'
            ? t('activityTimeline.events.repliedViaEmail', { defaultValue: 'Received via inbound email' })
            : activity.source === 'client_portal'
              ? t('activityTimeline.events.repliedViaPortal', { defaultValue: 'Received via client portal' })
              : undefined,
      };
    case 'TICKET_MESSAGE_ADDED':
    case 'TICKET_COMMENT_ADDED':
      return { title: t('activityTimeline.events.commentAdded', { defaultValue: '{{actor}} added a comment', actor }) };
    case 'TICKET_COMMENT_UPDATED':
      return { title: t('activityTimeline.events.commentEdited', { defaultValue: '{{actor}} edited a comment', actor }) };
    case 'TICKET_DOCUMENT_ATTACHED': {
      const name = (activity.details as { document_name?: string })?.document_name;
      return {
        title: t('activityTimeline.events.documentAttached', { defaultValue: '{{actor}} attached a document', actor }),
        subtitle: name ? name : undefined,
      };
    }
    case 'TICKET_DOCUMENT_REMOVED':
      return { title: t('activityTimeline.events.documentRemoved', { defaultValue: '{{actor}} removed a document', actor }) };
    case 'TICKET_INBOUND_EMAIL_RECEIVED': {
      const subject = (activity.details as { email?: { subject?: string } })?.email?.subject;
      return {
        title: t('activityTimeline.events.inboundEmailReceived', { defaultValue: 'Inbound email received' }),
        subtitle: subject ?? undefined,
      };
    }
    case 'TICKET_UPDATED': {
      const fields = Object.keys(activity.changes ?? {});
      return {
        title: t('activityTimeline.events.updated', { defaultValue: '{{actor}} updated the ticket', actor }),
        annotation,
        subtitle: fields.length > 0 ? fields.map((field) => fieldLabel(field, t)).join(', ') : undefined,
      };
    }
    case 'TICKET_EXTERNAL_LINK_ADDED':
      return { title: t('activityTimeline.events.externalLinkAdded', { defaultValue: '{{actor}} linked {{reference}}', actor, reference: externalLinkReference(activity, t) }) };
    case 'TICKET_EXTERNAL_LINK_UPDATED':
      return {
        title: t('activityTimeline.events.externalLinkUpdated', { defaultValue: '{{actor}} updated the {{reference}} link', actor, reference: externalLinkReference(activity, t) }),
        subtitle: activity.changes?.portal_visible
          ? `${visibilityLabel(activity.changes.portal_visible.old === true)} → ${visibilityLabel(activity.changes.portal_visible.new === true)}`
          : undefined,
      };
    case 'TICKET_EXTERNAL_LINK_REMOVED':
      return { title: t('activityTimeline.events.externalLinkRemoved', { defaultValue: '{{actor}} unlinked {{reference}}', actor, reference: externalLinkReference(activity, t) }) };
    default:
      return { title: t('activityTimeline.events.fallback', { defaultValue: '{{actor}} • {{eventType}}', actor, eventType: activity.event_type }) };
  }
}

export function formatEntries(
  entries: TicketTimelineEntry[],
  visibilityLabel: (visible: boolean) => string = (visible: boolean) => visible
    ? fallbackT('externalLinks.visibility.shared', { defaultValue: 'Visible in client portal' })
    : fallbackT('externalLinks.visibility.internal', { defaultValue: 'Internal only' }),
  t: TimelineT = fallbackT,
): FormattedEntry[] {
  return entries.map((entry) => {
    if (entry.type === 'activity' && entry.activity) {
      const desc = describeActivity(entry.activity, visibilityLabel, t);
      return {
        key: `activity-${entry.sortId}`,
        occurredAt: entry.occurredAt,
        icon: eventIcon(entry.activity.event_type),
        title: desc.title,
        annotation: desc.annotation,
        subtitle: desc.subtitle,
        source: entry.activity.source,
        actor: actorLabel(entry.activity, t),
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

    let title = t('activityTimeline.comment.added', { defaultValue: 'Comment added' });
    if (isInternal) title = t('activityTimeline.comment.internalNoteAdded', { defaultValue: 'Internal note added' });
    else if (authorType === 'client' || authorType === 'contact' || responseSource === 'client_portal') {
      title = t('activityTimeline.comment.customerReply', { defaultValue: 'Customer reply' });
    } else if (responseSource === 'inbound_email') {
      title = t('activityTimeline.comment.inboundEmailReply', { defaultValue: 'Inbound email reply' });
    }

    return {
      key: `comment-${entry.sortId}`,
      occurredAt: entry.occurredAt,
      icon: isInternal ? <Lock className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />,
      title,
      subtitle: undefined,
      source: responseSource ?? (isInternal ? 'internal' : 'ui'),
      actor: t('activityTimeline.comment.actor', { defaultValue: 'See conversation tab' }),
      entryType: 'comment',
      eventType: isInternal ? 'TICKET_INTERNAL_NOTE_ADDED' : 'TICKET_COMMENT_ADDED',
      actorType: authorType === 'client' || authorType === 'contact' ? 'contact' : 'user',
    };
  });
}

type FormatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions) => string;

// A bare toLocaleString() lets the language pick BOTH the digit order and the
// 12/24h clock; both belong to the country, so this runs through the central
// formatter with the parts spelled out.
function formatTimestamp(value: string, formatDate: FormatDate): string {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return formatDate(d, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return value;
  }
}

const ALL_FILTER_VALUE = '__all__';

const eventTypeOptions = (t: TimelineT): { value: string; label: string }[] => [
  { value: ALL_FILTER_VALUE, label: t('activityTimeline.filters.events.all', { defaultValue: 'All events' }) },
  { value: 'TICKET_CREATED', label: t('activityTimeline.filters.events.created', { defaultValue: 'Ticket created' }) },
  { value: 'TICKET_UPDATED', label: t('activityTimeline.filters.events.updated', { defaultValue: 'Ticket updated' }) },
  { value: 'TICKET_STATUS_CHANGED', label: t('activityTimeline.filters.events.statusChanged', { defaultValue: 'Status changed' }) },
  { value: 'TICKET_CLOSED', label: t('activityTimeline.filters.events.closed', { defaultValue: 'Closed' }) },
  { value: 'TICKET_REOPENED', label: t('activityTimeline.filters.events.reopened', { defaultValue: 'Reopened' }) },
  { value: 'TICKET_PRIORITY_CHANGED', label: t('activityTimeline.filters.events.priorityChanged', { defaultValue: 'Priority changed' }) },
  { value: 'TICKET_ASSIGNED', label: t('activityTimeline.filters.events.assigned', { defaultValue: 'Assigned' }) },
  { value: 'TICKET_UNASSIGNED', label: t('activityTimeline.filters.events.unassigned', { defaultValue: 'Unassigned' }) },
  { value: 'TICKET_BOARD_MOVED', label: t('activityTimeline.filters.events.boardMoved', { defaultValue: 'Board moved' }) },
  { value: 'TICKET_RESPONSE_STATE_CHANGED', label: t('activityTimeline.filters.events.responseState', { defaultValue: 'Response state' }) },
  { value: 'TICKET_MESSAGE_ADDED', label: t('activityTimeline.filters.events.messageAdded', { defaultValue: 'Comment added' }) },
  { value: 'TICKET_COMMENT_ADDED', label: t('activityTimeline.filters.events.commentAdded', { defaultValue: 'Comment added' }) },
  { value: 'TICKET_COMMENT_UPDATED', label: t('activityTimeline.filters.events.commentEdited', { defaultValue: 'Comment edited' }) },
  { value: 'TICKET_INTERNAL_NOTE_ADDED', label: t('activityTimeline.filters.events.internalNote', { defaultValue: 'Internal note' }) },
  { value: 'TICKET_CUSTOMER_REPLIED', label: t('activityTimeline.filters.events.customerReply', { defaultValue: 'Customer reply' }) },
  { value: 'TICKET_DOCUMENT_ATTACHED', label: t('activityTimeline.filters.events.documentAttached', { defaultValue: 'Document attached' }) },
  { value: 'TICKET_DOCUMENT_REMOVED', label: t('activityTimeline.filters.events.documentRemoved', { defaultValue: 'Document removed' }) },
  { value: 'TICKET_INBOUND_EMAIL_RECEIVED', label: t('activityTimeline.filters.events.inboundEmail', { defaultValue: 'Inbound email' }) },
  { value: 'TICKET_CREATED_FROM_TEMPLATE', label: t('activityTimeline.filters.events.createdFromTemplate', { defaultValue: 'Created from template' }) },
  { value: 'TICKET_DUPLICATED_FROM', label: t('activityTimeline.filters.events.duplicatedFrom', { defaultValue: 'Duplicated from' }) },
  { value: 'TICKET_DUPLICATED_TO', label: t('activityTimeline.filters.events.duplicatedTo', { defaultValue: 'Duplicated to' }) },
  { value: 'TICKET_BUNDLE_REOPENED', label: t('activityTimeline.filters.events.bundleReopened', { defaultValue: 'Bundle reopened' }) },
  { value: 'TICKET_BUNDLE_STATUS_PROPAGATED', label: t('activityTimeline.filters.events.bundleStatusPropagated', { defaultValue: 'Bundle status propagated' }) },
];

const sourceOptions = (t: TimelineT): { value: string; label: string }[] => [
  { value: ALL_FILTER_VALUE, label: t('activityTimeline.filters.sources.all', { defaultValue: 'All sources' }) },
  // 'UI' and 'API' are acronyms, identical in every shipped locale.
  { value: 'ui', label: 'UI' },
  { value: 'api', label: 'API' },
  { value: 'client_portal', label: t('activityTimeline.filters.sources.clientPortal', { defaultValue: 'Client Portal' }) },
  { value: 'inbound_email', label: t('activityTimeline.filters.sources.inboundEmail', { defaultValue: 'Inbound Email' }) },
  { value: 'workflow', label: t('activityTimeline.filters.sources.workflow', { defaultValue: 'Workflow' }) },
  { value: 'system', label: t('activityTimeline.filters.sources.system', { defaultValue: 'System' }) },
  { value: 'internal', label: t('activityTimeline.filters.sources.internalNote', { defaultValue: 'Internal Note' }) },
];

const actorTypeOptions = (t: TimelineT): { value: string; label: string }[] => [
  { value: ALL_FILTER_VALUE, label: t('activityTimeline.filters.actors.all', { defaultValue: 'All actors' }) },
  { value: 'user', label: t('activityTimeline.filters.actors.user', { defaultValue: 'User' }) },
  { value: 'contact', label: t('activityTimeline.filters.actors.contact', { defaultValue: 'Contact' }) },
  { value: 'email_sender', label: t('activityTimeline.filters.actors.emailSender', { defaultValue: 'Email sender' }) },
  { value: 'api', label: t('activityTimeline.actor.apiClient', { defaultValue: 'API client' }) },
  { value: 'workflow', label: t('activityTimeline.filters.actors.workflow', { defaultValue: 'Workflow' }) },
  { value: 'system', label: t('activityTimeline.filters.actors.system', { defaultValue: 'System' }) },
];

const entryTypeOptions = (t: TimelineT): { value: string; label: string }[] => [
  { value: ALL_FILTER_VALUE, label: t('activityTimeline.filters.entries.all', { defaultValue: 'All entries' }) },
  { value: 'activity', label: t('activityTimeline.filters.entries.activity', { defaultValue: 'Activity only' }) },
  { value: 'comment', label: t('activityTimeline.filters.entries.comments', { defaultValue: 'Comments only' }) },
];

function sourceBadge(source: string, t: TimelineT): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    // 'UI' and 'API' are acronyms, identical in every shipped locale.
    ui: { label: 'UI', className: 'chip-primary' },
    api: { label: 'API', className: 'chip-secondary' },
    client_portal: { label: t('activityTimeline.filters.sources.clientPortal', { defaultValue: 'Client Portal' }), className: 'bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
    inbound_email: { label: t('activityTimeline.filters.sources.inboundEmail', { defaultValue: 'Inbound Email' }), className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
    workflow: { label: t('activityTimeline.filters.sources.workflow', { defaultValue: 'Workflow' }), className: 'bg-purple-50 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' },
    system: { label: t('activityTimeline.filters.sources.system', { defaultValue: 'System' }), className: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]' },
    internal: { label: t('activityTimeline.filters.sources.internalNote', { defaultValue: 'Internal Note' }), className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
  };
  return (
    map[source] ?? {
      label: source,
      className: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]',
    }
  );
}

export function TicketActivityTimeline({ ticketId, refreshKey = 0 }: TicketActivityTimelineProps) {
  const { getTicketTimelineEntries } = useTicketDataSource().activity;
  const { t: tCommon } = useTranslation('common');
  const { t: tTickets } = useTranslation('features/tickets');
  const { formatDate } = useFormatters();
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
        setError(tTickets('activityTimeline.errors.loadFailed', { defaultValue: 'Failed to load ticket activity timeline.' }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey, getTicketTimelineEntries]);

  // All hooks must run unconditionally on every render — keep useMemo/etc.
  // above the loading/error early returns to satisfy the rules of hooks.
  const formatted = useMemo(() => formatEntries(entries ?? [], (visible) => visible
    ? tTickets('externalLinks.visibility.shared', 'Visible in client portal')
    : tTickets('externalLinks.visibility.internal', 'Internal only'), tTickets), [entries, tTickets]);

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

  const entryTypeFilterOptions = useMemo(() => entryTypeOptions(tTickets), [tTickets]);
  const eventTypeFilterOptions = useMemo(() => eventTypeOptions(tTickets), [tTickets]);
  const sourceFilterOptions = useMemo(() => sourceOptions(tTickets), [tTickets]);
  const actorTypeFilterOptions = useMemo(() => actorTypeOptions(tTickets), [tTickets]);

  const resetFilters = () => {
    setEntryTypeFilter(ALL_FILTER_VALUE);
    setEventTypeFilter(ALL_FILTER_VALUE);
    setSourceFilter(ALL_FILTER_VALUE);
    setActorTypeFilter(ALL_FILTER_VALUE);
  };

  const columns: ColumnDefinition<FormattedEntry>[] = useMemo(
    () => [
      {
        title: tTickets('activityTimeline.columns.when', { defaultValue: 'When' }),
        dataIndex: 'occurredAt',
        width: '180px',
        render: (value: unknown) => (
          <time
            className="whitespace-nowrap text-xs text-[rgb(var(--color-text-700))]"
            dateTime={typeof value === 'string' ? value : undefined}
            title={typeof value === 'string' ? value : undefined}
          >
            {formatTimestamp(String(value), formatDate)}
          </time>
        ),
      },
      {
        title: tTickets('activityTimeline.columns.event', { defaultValue: 'Event' }),
        dataIndex: 'title',
        render: (_value: unknown, record: FormattedEntry) => (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]">
              {record.icon}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-medium text-[rgb(var(--color-text-900))]">
                <span>{record.title}</span>
                {record.annotation ? (
                  <span className="rounded-full bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 text-[11px] font-normal text-[rgb(var(--color-text-500))]">
                    {record.annotation}
                  </span>
                ) : null}
              </div>
              {record.subtitle ? (
                <div className="text-xs text-[rgb(var(--color-text-700))]">{record.subtitle}</div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        title: tTickets('activityTimeline.columns.source', { defaultValue: 'Source' }),
        dataIndex: 'source',
        width: '140px',
        render: (value: unknown) => {
          const badge = sourceBadge(String(value ?? ''), tTickets);
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
        title: tTickets('activityTimeline.columns.actor', { defaultValue: 'Actor' }),
        dataIndex: 'actor',
        width: '180px',
        render: (value: unknown, record: FormattedEntry) => (
          <span className="inline-flex items-center gap-1 text-xs text-[rgb(var(--color-text-700))]">
            <User2 className="h-3 w-3" />
            {String(value ?? '')}
            <ViaPrincipalLabel principalName={record.rawActivity?.via_principal_name} />
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
                  {tTickets('activityTimeline.actions.hide', { defaultValue: 'Hide' })}
                </>
              ) : (
                <>
                  <ChevronRight className="mr-1 h-3 w-3" />
                  {tTickets('activityTimeline.actions.details', { defaultValue: 'Details' })}
                </>
              )}
            </Button>
          );
        },
      },
    ],
    [expandedKey, formatDate, tTickets],
  );

  const filterBar = (
    <div
      id="ticket-activity-timeline-filters"
      className="flex flex-wrap items-end gap-2 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-2"
    >
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-entry-type">
          {tTickets('activityTimeline.filters.entryType', { defaultValue: 'Type' })}
        </label>
        <CustomSelect
          id="ticket-activity-filter-entry-type"
          value={entryTypeFilter}
          options={entryTypeFilterOptions}
          onValueChange={setEntryTypeFilter}
        />
      </div>
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-event-type">
          {tTickets('activityTimeline.filters.eventType', { defaultValue: 'Event' })}
        </label>
        <CustomSelect
          id="ticket-activity-filter-event-type"
          value={eventTypeFilter}
          options={eventTypeFilterOptions}
          onValueChange={setEventTypeFilter}
        />
      </div>
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-source">
          {tTickets('activityTimeline.filters.source', { defaultValue: 'Source' })}
        </label>
        <CustomSelect
          id="ticket-activity-filter-source"
          value={sourceFilter}
          options={sourceFilterOptions}
          onValueChange={setSourceFilter}
        />
      </div>
      <div className="flex flex-col">
        <label className="mb-1 text-xs text-[rgb(var(--color-text-500))]" htmlFor="ticket-activity-filter-actor-type">
          {tTickets('activityTimeline.filters.actorType', { defaultValue: 'Actor' })}
        </label>
        <CustomSelect
          id="ticket-activity-filter-actor-type"
          value={actorTypeFilter}
          options={actorTypeFilterOptions}
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
          {tTickets('activityTimeline.filters.reset', { defaultValue: 'Reset filters' })}
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
        {tTickets('activityTimeline.errors.loadFailedPrefix', { defaultValue: 'Failed to load activity timeline:' })} {error}
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
          {tTickets('activityTimeline.empty.noActivity', { defaultValue: 'No activity yet. New events will appear here as the ticket changes.' })}
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
            {tTickets('activityTimeline.empty.noMatches', { defaultValue: 'No entries match the current filters.' })}
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
                {tCommon('actions.close', { defaultValue: 'Close' })}
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
