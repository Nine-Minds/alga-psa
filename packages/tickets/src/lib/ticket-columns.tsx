import React from 'react';
import Link from 'next/link';
import type { ColumnDefinition, ITicketListItem, ITicketCategory, TicketResponseState, ITag, IBoard } from '@alga-psa/types';
import { TagManager } from '@alga-psa/tags/components';
import type { TagSize } from '@alga-psa/ui/components/tags';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ResponseStateBadge } from '@alga-psa/ui/components/tickets/ResponseStateBadge';
import { SlaIndicator } from '@alga-psa/ui/components/sla';
import type { SlaTimerStatus } from '@alga-psa/types';

/**
 * Calculate SLA status from ticket data
 */
function calculateSlaStatus(ticket: ITicketListItem): {
  status: SlaTimerStatus;
  remainingMinutes: number | undefined;
  isPaused: boolean;
} | null {
  // No SLA if no policy assigned
  if (!ticket.sla_policy_id) {
    return null;
  }

  const now = new Date();
  const isPaused = ticket.sla_paused_at !== null && ticket.sla_paused_at !== undefined;

  // Check response SLA first (if not yet responded)
  if (!ticket.sla_response_at && ticket.sla_response_due_at) {
    const responseDue = new Date(ticket.sla_response_due_at);
    const remainingMs = responseDue.getTime() - now.getTime();
    const remainingMinutes = Math.round(remainingMs / 60000);

    if (isPaused) {
      return { status: 'paused', remainingMinutes, isPaused: true };
    }

    if (remainingMinutes < 0) {
      return { status: 'response_breached', remainingMinutes, isPaused: false };
    }

    // At risk if less than 20% time remaining (rough estimate)
    const totalMs = responseDue.getTime() - new Date(ticket.sla_started_at || ticket.entered_at || '').getTime();
    const elapsedPercent = totalMs > 0 ? ((totalMs - remainingMs) / totalMs) * 100 : 0;

    if (elapsedPercent >= 80) {
      return { status: 'at_risk', remainingMinutes, isPaused: false };
    }

    return { status: 'on_track', remainingMinutes, isPaused: false };
  }

  // Check resolution SLA (if not yet resolved)
  if (!ticket.sla_resolution_at && ticket.sla_resolution_due_at) {
    const resolutionDue = new Date(ticket.sla_resolution_due_at);
    const remainingMs = resolutionDue.getTime() - now.getTime();
    const remainingMinutes = Math.round(remainingMs / 60000);

    if (isPaused) {
      return { status: 'paused', remainingMinutes, isPaused: true };
    }

    if (remainingMinutes < 0) {
      return { status: 'resolution_breached', remainingMinutes, isPaused: false };
    }

    const totalMs = resolutionDue.getTime() - new Date(ticket.sla_started_at || ticket.entered_at || '').getTime();
    const elapsedPercent = totalMs > 0 ? ((totalMs - remainingMs) / totalMs) * 100 : 0;

    if (elapsedPercent >= 80) {
      return { status: 'at_risk', remainingMinutes, isPaused: false };
    }

    return { status: 'on_track', remainingMinutes, isPaused: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Presentation helpers — "Refined List" look (redesign candidate #1):
// hero title + mono id/category subtitle, semantic status pills, priority
// bars, initials avatars, and a relative Due column.
// ---------------------------------------------------------------------------

// Deterministic avatar palette so the same client/agent always gets the same hue.
const AVATAR_PALETTE = [
  '#8a4dea', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#6366f1', '#ec4899', '#14b8a6', '#f97316', '#3b82f6',
];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function avatarColor(seed: string | null | undefined): string {
  if (!seed) return '#94a3b8';
  return AVATAR_PALETTE[hashString(seed) % AVATAR_PALETTE.length];
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Status pill hues (space-separated R G B). The pill background is a translucent
// tint of the hue so it blends with the surface in BOTH light and dark mode
// (rather than a fixed light fill that glares on a dark card); the solid hue is
// used for the dot, and pill text stays neutral (--color-text-700, which flips
// with the theme) so it reads on either background. Open statuses get a stable
// hue by name (Alga statuses are per-board/custom, no fixed semantic set); closed
// statuses always read green.
const STATUS_PILL_HUES = [
  '138 77 234',  // brand violet
  '64 207 249',  // brand cyan
  '255 156 48',  // brand amber
  '99 102 241',  // indigo
  '236 72 153',  // pink
  '20 184 166',  // teal
];
const STATUS_PILL_CLOSED_HUE = '34 197 94'; // green

function statusPillHue(statusName: string, closed: boolean): string {
  if (closed) return STATUS_PILL_CLOSED_HUE;
  return STATUS_PILL_HUES[hashString(statusName || 'status') % STATUS_PILL_HUES.length];
}

// Compact relative due label, e.g. "Overdue 2d", "in 5h", "in 3 days".
function relativeDueLabel(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const overdue = ms < 0;
  const absMs = Math.abs(ms);
  const days = Math.floor(absMs / dayMs);
  const hours = Math.floor(absMs / (60 * 60 * 1000));
  let magnitude: string;
  if (days >= 1) magnitude = `${days}d`;
  else if (hours >= 1) magnitude = `${hours}h`;
  else magnitude = `${Math.max(1, Math.round(absMs / 60000))}m`;
  if (overdue) return `Overdue ${magnitude}`;
  return days >= 1 ? `in ${days} days` : `in ${magnitude}`;
}

// Smart due-date label matching candidate #1: "Overdue 1d" / "Today 4:00 PM" /
// "Tomorrow 9:00 AM" / "Fri, Jun 21" (year added only when not the current year).
function formatDuePrimary(due: Date, now: Date): string {
  if (due.getTime() < now.getTime()) {
    return relativeDueLabel(due, now); // "Overdue 5h" / "Overdue 1d"
  }
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((dueDay.getTime() - startOfToday.getTime()) / 86400000);
  const isMidnight = due.getHours() === 0 && due.getMinutes() === 0;
  if (dayDiff === 0) return isMidnight ? 'Today' : `Today ${format(due, 'h:mm a')}`;
  if (dayDiff === 1) return isMidnight ? 'Tomorrow' : `Tomorrow ${format(due, 'h:mm a')}`;
  return format(due, due.getFullYear() === now.getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy');
}

// Calendar-day count to a future due date, for the secondary "in N days" hint.
function daysUntil(due: Date, now: Date): number {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(due); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Compact SLA status for the merged Due/SLA cell (candidate #1). Derived from the
// same calculateSlaStatus the standalone SLA column uses; tone drives urgency color.
function slaMagnitude(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs >= 1440) return `${Math.round(abs / 1440)}d`;
  if (abs >= 60) return `${Math.round(abs / 60)}h`;
  return `${Math.max(1, abs)}m`;
}

function formatSlaCell(
  sla: { status: SlaTimerStatus; remainingMinutes: number | undefined; isPaused: boolean } | null
): { text: string; tone: 'over' | 'soon' | 'ok' } | null {
  if (!sla) return null;
  if (sla.status === 'response_breached' || sla.status === 'resolution_breached') {
    return { text: 'SLA breached', tone: 'over' };
  }
  if (sla.status === 'paused') return { text: 'SLA paused', tone: 'ok' };
  const mag = sla.remainingMinutes !== undefined ? slaMagnitude(sla.remainingMinutes) : null;
  if (sla.status === 'at_risk') return { text: mag ? `${mag} left` : 'At risk', tone: 'soon' };
  return { text: mag ? `${mag} left` : 'On track', tone: 'ok' };
}

// Shared category label resolver, used by both the category column and the
// category subtitle folded under the title cell.
function formatCategoryLabel(record: ITicketListItem, categories: ITicketCategory[]): string {
  const categoryId = record.category_id || null;
  if (!categoryId && !record.subcategory_id) return 'No Category';
  if (record.subcategory_id) {
    const subcategory = categories.find(c => c.category_id === record.subcategory_id);
    if (!subcategory) return 'Unknown Category';
    const parent = categories.find(c => c.category_id === subcategory.parent_category);
    return parent ? `${parent.category_name} → ${subcategory.category_name}` : subcategory.category_name;
  }
  const category = categories.find(c => c.category_id === categoryId);
  if (!category) return 'Unknown Category';
  return category.category_name;
}

type TicketListColumnKey =
  | 'ticket_number'
  | 'title'
  | 'status'
  | 'priority'
  | 'sla'
  | 'board'
  | 'category'
  | 'client'
  | 'assigned_to'
  | 'due_date'
  | 'created'
  | 'created_by'
  | 'tags';

type TicketListSettings = {
  columnVisibility?: Partial<Record<TicketListColumnKey, boolean>>;
  tagsInlineUnderTitle?: boolean;
};

type TicketingDisplaySettings = {
  dateTimeFormat?: string;
  responseStateTrackingEnabled?: boolean;
  list?: TicketListSettings;
};

interface CreateTicketColumnsOptions {
  categories: ITicketCategory[];
  boards: IBoard[];
  displaySettings?: TicketingDisplaySettings;
  onTicketClick: (ticketId: string) => void;
  ticketTagsRef?: React.MutableRefObject<Record<string, ITag[]>>;
  onTagsChange?: (ticketId: string, tags: ITag[]) => void;
  tagSize?: TagSize;
  showTags?: boolean;
  showClient?: boolean;
  onClientClick?: (clientId: string) => void;
  /** Map of user IDs to avatar URLs for displaying in additional agents tooltip */
  additionalAgentAvatarUrls?: Record<string, string | null>;
  /** Map of team IDs to avatar URLs for displaying team badges */
  teamAvatarUrls?: Record<string, string | null>;
  isBundleExpanded?: (masterTicketId: string) => boolean;
  onToggleBundleExpanded?: (masterTicketId: string) => void;
  t?: (key: string, fallback: string) => string;
  showAllAvailableColumns?: boolean;
}

const ALL_TICKET_LIST_COLUMN_VISIBILITY: Record<TicketListColumnKey, boolean> = {
  ticket_number: true,
  title: true,
  status: true,
  priority: true,
  sla: true,
  board: true,
  category: true,
  client: true,
  assigned_to: true,
  due_date: true,
  created: true,
  created_by: true,
  tags: true,
};

export function createTicketColumns(options: CreateTicketColumnsOptions): ColumnDefinition<ITicketListItem>[] {
  const {
    categories,
    boards: _boards,
    displaySettings,
    onTicketClick,
    ticketTagsRef,
    onTagsChange,
    tagSize = 'md',
    showTags = true,
    showClient = true,
    onClientClick,
    additionalAgentAvatarUrls = {},
    teamAvatarUrls = {},
    isBundleExpanded,
    onToggleBundleExpanded,
    t: _t,
    showAllAvailableColumns = false,
  } = options;

  const t = _t ?? ((_key: string, fallback: string) => fallback);

  // Default on-screen column set mirrors redesign candidate #1: ticket number
  // and category fold under the title, created/created-by and the standalone SLA
  // column are off by default (still enableable via display settings / print).
  const columnVisibility = showAllAvailableColumns ? ALL_TICKET_LIST_COLUMN_VISIBILITY : (displaySettings?.list?.columnVisibility || {
    ticket_number: false,
    title: true,
    status: true,
    priority: true,
    sla: false,
    board: true,
    category: false,
    client: true,
    assigned_to: true,
    due_date: true,
    created: false,
    created_by: false,
    tags: true,
  });

  const tagsInlineUnderTitle = displaySettings?.list?.tagsInlineUnderTitle ?? true;
  const showInlineTagsInTitle = columnVisibility.tags && showTags && !showAllAvailableColumns;
  const dateTimeFormat = displaySettings?.dateTimeFormat || 'MMM d, yyyy h:mm a';

  // When a dedicated ticket-number / category column isn't shown, fold those
  // values under the title (the candidate #1 "Ticket" cell). Never fold in the
  // print/export path, which renders every column separately.
  const foldIntoTitle = !showAllAvailableColumns;
  const showTicketNumberSubtitle = foldIntoTitle && !columnVisibility.ticket_number;
  const showCategorySubtitle = foldIntoTitle && !columnVisibility.category;

  const columns: Array<{ key: string; col: ColumnDefinition<ITicketListItem> }> = [];

  // Ticket Number
  if (columnVisibility.ticket_number) {
    columns.push({
      key: 'ticket_number',
      col: {
        title: t('fields.ticketNumber', 'Ticket Number'),
        dataIndex: 'ticket_number',
        width: '7%',
        render: (value: string, record: ITicketListItem) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              {!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 && onToggleBundleExpanded ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 relative z-10"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleBundleExpanded(record.ticket_id as string);
                  }}
                  aria-label="Toggle bundle children"
                >
                  {isBundleExpanded && isBundleExpanded(record.ticket_id as string) ? (
                    <ChevronDown className="h-4 w-4 text-gray-600" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-600" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTicketClick(record.ticket_id as string);
                }}
                className="text-blue-600 hover:text-blue-800 whitespace-normal text-left bg-transparent border-none p-0 cursor-pointer"
              >
                {value}
              </button>
            </span>
            {(record.master_ticket_id || (!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0)) && (
              <div className="flex items-center gap-1">
                {record.master_ticket_id ? (
                  <span 
                    className="rounded px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      color: 'rgb(var(--color-primary-700))',
                      backgroundColor: 'rgb(var(--color-primary-100))'
                    }}
                  >
                    Bundled → {record.bundle_master_ticket_number || 'Master'}
                  </span>
                ) : null}
                {!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 ? (
                  <span 
                    className="rounded px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      color: 'rgb(var(--color-secondary-700))',
                      backgroundColor: 'rgb(var(--color-secondary-100))'
                    }}
                  >
                    Bundle · {record.bundle_child_count}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ),
      }
    });
  }

  // Title — the "Ticket" hero cell: bold title with the mono ticket number and
  // category folded underneath when those columns aren't shown separately.
  columns.push({
    key: 'title',
    col: {
      title: t('fields.title', 'Title'),
      dataIndex: 'title',
      width: showInlineTagsInTitle ? '26%' : '24%',
      render: (value: string, record: ITicketListItem) => {
        const isBundleMaster = !record.master_ticket_id && (record.bundle_child_count ?? 0) > 0;
        const showBundleToggle = showTicketNumberSubtitle && isBundleMaster && !!onToggleBundleExpanded;
        const categoryLabel = formatCategoryLabel(record, categories);
        return (
          <div className="flex items-start gap-2 overflow-hidden">
            {showBundleToggle && (
              <button
                type="button"
                className="mt-0.5 inline-flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 relative z-10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleBundleExpanded!(record.ticket_id as string);
                }}
                aria-label="Toggle bundle children"
              >
                {isBundleExpanded && isBundleExpanded(record.ticket_id as string) ? (
                  <ChevronDown className="h-4 w-4 text-gray-600" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                )}
              </button>
            )}
            <div className="flex flex-col gap-0.5 overflow-hidden">
              <Link
                href={`/msp/tickets/${record.ticket_id}`}
                prefetch={false}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onTicketClick(record.ticket_id as string);
                }}
                className="block truncate font-semibold text-[rgb(var(--color-text-900))] hover:text-[rgb(var(--color-primary-700))]"
              >
                {value}
              </Link>
              {(showTicketNumberSubtitle || showCategorySubtitle) && (
                <div className="flex items-center gap-1.5 overflow-hidden text-[11px] leading-tight text-[rgb(var(--color-text-500))]">
                  {showTicketNumberSubtitle && (
                    <Link
                      href={`/msp/tickets/${record.ticket_id}`}
                      prefetch={false}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onTicketClick(record.ticket_id as string);
                      }}
                      className="shrink-0 font-mono text-[11px] text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-primary-600))]"
                    >
                      {record.ticket_number}
                    </Link>
                  )}
                  {showTicketNumberSubtitle && showCategorySubtitle && (
                    <span className="text-[rgb(var(--color-text-300))]">·</span>
                  )}
                  {showCategorySubtitle && <span className="truncate">{categoryLabel}</span>}
                </div>
              )}
              {showTicketNumberSubtitle && record.master_ticket_id && (
                <span
                  className="w-fit rounded px-2 py-0.5 text-[11px] font-medium"
                  style={{ color: 'rgb(var(--color-primary-700))', backgroundColor: 'rgb(var(--color-primary-100))' }}
                >
                  Bundled → {record.bundle_master_ticket_number || 'Master'}
                </span>
              )}
              {showTicketNumberSubtitle && isBundleMaster && (
                <span
                  className="w-fit rounded px-2 py-0.5 text-[11px] font-medium"
                  style={{ color: 'rgb(var(--color-secondary-700))', backgroundColor: 'rgb(var(--color-secondary-100))' }}
                >
                  Bundle · {record.bundle_child_count}
                </span>
              )}
              {showInlineTagsInTitle && ticketTagsRef && onTagsChange && record.ticket_id && (ticketTagsRef.current[record.ticket_id]?.length ?? 0) > 0 && (
                <div onClick={(e) => e.stopPropagation()}>
                  <TagManager
                    entityId={record.ticket_id}
                    entityType="ticket"
                    initialTags={ticketTagsRef.current[record.ticket_id] || []}
                    onTagsChange={(tags) => onTagsChange(record.ticket_id!, tags)}
                    size={tagSize}
                  />
                </div>
              )}
            </div>
          </div>
        );
      },
    }
  });

  // Status (with response state badge)
  if (columnVisibility.status) {
    columns.push({
      key: 'status',
      col: {
        title: t('fields.status', 'Status'),
        dataIndex: 'status_name',
        width: '8%',
        render: (value: string, record: ITicketListItem) => {
          // Get response_state from the record - it may be on the record if fetched
          const responseState = (record as any).response_state as TicketResponseState | undefined;
          const showResponseState = displaySettings?.responseStateTrackingEnabled !== false;
          const closed = !!(record as { is_closed?: boolean }).is_closed;
          const hue = statusPillHue(value || '', closed);
          return (
            <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
              <span
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-text-700))]"
                style={{ backgroundColor: `rgb(${hue} / 0.14)`, borderColor: `rgb(${hue} / 0.30)` }}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `rgb(${hue})` }} />
                <span className="overflow-hidden text-ellipsis">{value || 'No Status'}</span>
              </span>
              {showResponseState && responseState && (
                <ResponseStateBadge
                  responseState={responseState}
                  variant="text"
                  size="sm"
                  className="h-5 w-5 shrink-0 justify-center overflow-hidden border-transparent !bg-transparent px-0 py-0 text-transparent opacity-75 [&_span]:hidden"
                />
              )}
            </div>
          );
        },
      }
    });
  }

  // Priority
  if (columnVisibility.priority) {
    columns.push({
      key: 'priority',
      col: {
        title: t('fields.priority', 'Priority'),
        dataIndex: 'priority_name',
        width: '7%',
        render: (value: string, record: ITicketListItem) => {
          // All tickets now use the unified priority system with priority_name and priority_color.
          // Candidate #1 renders priority as a colored bar + label for at-a-glance scanning.
          return (
            <div className="flex items-center gap-2">
              <span
                className="h-3.5 w-[3px] shrink-0 rounded-full"
                style={{ backgroundColor: record.priority_color || '#94a3b8' }}
              />
              <span className="font-medium text-[rgb(var(--color-text-700))]">{value || 'No Priority'}</span>
            </div>
          );
        },
      }
    });
  }

  // SLA Status
  if (columnVisibility.sla) {
    columns.push({
      key: 'sla',
      col: {
        title: t('fields.sla', 'SLA'),
        dataIndex: 'sla_policy_id',
        width: '5%',
        sortable: false,
        render: (_value: string | null, record: ITicketListItem) => {
          const slaStatus = calculateSlaStatus(record);

          if (!slaStatus) {
            return <span className="text-gray-400 text-xs">-</span>;
          }

          return (
            <SlaIndicator
              status={slaStatus.status}
              remainingMinutes={slaStatus.remainingMinutes!}
              isPaused={slaStatus.isPaused}
            />
          );
        },
      }
    });
  }

  // Board
  if (columnVisibility.board) {
    columns.push({
      key: 'board',
      col: {
        title: t('fields.board', 'Board'),
        dataIndex: 'board_name',
        width: '8%',
        render: (value: string) => value ? (
          <span className="inline-block rounded-md bg-[rgb(var(--color-border-100))] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--color-text-600))]">
            {value}
          </span>
        ) : <span className="text-[rgb(var(--color-text-400))]">-</span>,
      }
    });
  }

  // Category
  if (columnVisibility.category) {
    columns.push({
      key: 'category',
      col: {
        title: t('fields.category', 'Category'),
        dataIndex: 'category_name',
        width: '7%',
        render: (_value: string, record: ITicketListItem) => formatCategoryLabel(record, categories),
      }
    });
  }

  // Client
  if (columnVisibility.client && showClient) {
    columns.push({
      key: 'client',
      col: {
        title: t('fields.client', 'Client'),
        dataIndex: 'client_name',
        width: '9%',
        render: (value: string, record: ITicketListItem) => {
          const hasClient = !!value;
          const multiClient = !record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 && (record.bundle_distinct_client_count ?? 0) > 1;
          const body = (
            <span className="flex items-center gap-2 overflow-hidden">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                style={{ backgroundColor: hasClient ? avatarColor(record.client_id || value) : '#cbd5e1' }}
              >
                {hasClient ? getInitials(value) : '—'}
              </span>
              <span className="flex flex-col gap-0.5 overflow-hidden">
                <span className="truncate">{value || 'No Client'}</span>
                {multiClient ? (
                  <span
                    className="w-fit rounded px-2 py-0.5 text-[11px] font-medium"
                    style={{ color: 'rgb(var(--color-accent-700))', backgroundColor: 'rgb(var(--color-accent-100))' }}
                  >
                    Multiple clients
                  </span>
                ) : null}
              </span>
            </span>
          );
          if (!onClientClick) {
            return <span className="text-[rgb(var(--color-text-700))]">{body}</span>;
          }
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (record.client_id) onClientClick(record.client_id);
              }}
              className="bg-transparent border-none p-0 text-left text-[rgb(var(--color-text-700))] hover:[&_.truncate]:text-[rgb(var(--color-primary-700))]"
            >
              {body}
            </button>
          );
        },
      }
    });
  }

  // Assigned To
  if (columnVisibility.assigned_to) {
    columns.push({
      key: 'assigned_to',
      col: {
        title: t('fields.assignedTo', 'Assigned To'),
        dataIndex: 'assigned_to_name',
        width: '8%',
        render: (value: string | null, record: ITicketListItem) => {
          const additionalCount = record.additional_agent_count || 0;
          const additionalAgents = record.additional_agents || [];
          return (
            <span className="text-gray-700 flex items-center gap-2">
              {value ? (
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(value) }}
                >
                  {getInitials(value)}
                </span>
              ) : (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-[rgb(var(--color-border-400))] text-xs text-[rgb(var(--color-text-400))]">
                  +
                </span>
              )}
              <span className="truncate">{value || 'Unassigned'}</span>
              {record.assigned_team_id && record.assigned_team_name && (
                <Tooltip content={record.assigned_team_name}>
                  <span className="inline-flex items-center cursor-help">
                    <TeamAvatar
                      teamId={record.assigned_team_id}
                      teamName={record.assigned_team_name}
                      avatarUrl={teamAvatarUrls[record.assigned_team_id] ?? null}
                      size="xs"
                    />
                  </span>
                </Tooltip>
              )}
              {additionalCount > 0 && (
                <Tooltip
                  content={
                    <div className="text-xs space-y-1.5">
                      <div className="font-medium text-gray-300 mb-1">Additional Agents:</div>
                      {additionalAgents.map((agent, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <UserAvatar
                            userId={agent.user_id}
                            userName={agent.name}
                            avatarUrl={additionalAgentAvatarUrls[agent.user_id] ?? null}
                            size="xs"
                          />
                          <span>{agent.name}</span>
                        </div>
                      ))}
                    </div>
                  }
                >
                  <span
                    className="px-1.5 py-0.5 text-xs font-medium rounded-full cursor-help"
                    style={{
                      color: 'rgb(var(--color-primary-500))',
                      backgroundColor: 'rgb(var(--color-primary-50))'
                    }}
                  >
                    +{additionalCount}
                  </span>
                </Tooltip>
              )}
            </span>
          );
        },
      }
    });
  }

  // Due Date
  if (columnVisibility.due_date) {
    columns.push({
      key: 'due_date',
      col: {
        title: `${t('fields.dueDate', 'Due Date')} / ${t('fields.sla', 'SLA')}`,
        dataIndex: 'due_date',
        width: '9%',
        render: (value: string | null, record: ITicketListItem) => {
          const now = new Date();
          const sla = formatSlaCell(calculateSlaStatus(record));
          const dueDate = value ? new Date(value) : null;

          const toneClass = (tone: 'over' | 'soon' | 'ok' | 'muted'): string =>
            tone === 'over' ? 'text-red-600 dark:text-red-400 font-medium'
              : tone === 'soon' ? 'text-orange-600 dark:text-orange-400'
                : 'text-[rgb(var(--color-text-400))]';

          // Secondary line: live SLA state when the ticket has an SLA policy;
          // otherwise a relative "in N days" hint for future dates (overdue / today /
          // tomorrow are already explicit in the primary label — no redundant line).
          let secondary: { text: string; tone: 'over' | 'soon' | 'ok' | 'muted' } | null = null;
          if (sla) {
            secondary = { text: sla.text, tone: sla.tone };
          } else if (dueDate && dueDate.getTime() >= now.getTime()) {
            const d = daysUntil(dueDate, now);
            if (d >= 2) secondary = { text: `in ${d} days`, tone: 'muted' };
          }

          // Primary date colour: SLA urgency wins, then due-date urgency.
          let primaryClass = 'text-[rgb(var(--color-text-700))]';
          if (sla?.tone === 'over') primaryClass = 'text-red-600 dark:text-red-400';
          else if (sla?.tone === 'soon') primaryClass = 'text-orange-600 dark:text-orange-400';
          else if (dueDate) {
            const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
            if (hoursUntilDue < 0) primaryClass = 'text-red-600 dark:text-red-400';
            else if (hoursUntilDue <= 24) primaryClass = 'text-orange-600 dark:text-orange-400';
          }

          let primaryText: string;
          if (dueDate) {
            primaryText = formatDuePrimary(dueDate, now);
          } else {
            // No due date — still surface SLA below it if present.
            if (!secondary) {
              return <div className="text-sm text-[rgb(var(--color-text-400))]">No due date</div>;
            }
            primaryText = 'No due date';
          }

          return (
            <div className="flex flex-col leading-tight">
              <span className={dueDate ? `text-sm font-medium ${primaryClass}` : 'text-sm text-[rgb(var(--color-text-400))]'}>{primaryText}</span>
              {secondary && <span className={`text-[11px] ${toneClass(secondary.tone)}`}>{secondary.text}</span>}
            </div>
          );
        },
      }
    });
  }

  // Created
  if (columnVisibility.created) {
    columns.push({
      key: 'created',
      col: {
        title: t('fields.created', 'Created'),
        dataIndex: 'entered_at',
        width: '10%',
        render: (value: string | null) => (
          <div className="text-sm text-gray-500">
            {value ? format(new Date(value), dateTimeFormat) : '-'}
          </div>
        ),
      }
    });
  }

  // Created By
  if (columnVisibility.created_by) {
    columns.push({
      key: 'created_by',
      col: {
        title: t('fields.createdBy', 'Created By'),
        dataIndex: 'entered_by_name',
        width: '6%',
      }
    });
  }

  // Tags (as separate column; retained for print/export column selection, not the default ticket list)
  if (showAllAvailableColumns && columnVisibility.tags && !tagsInlineUnderTitle && showTags && ticketTagsRef && onTagsChange) {
    columns.push({
      key: 'tags',
      col: {
        title: t('fields.tags', 'Tags'),
        dataIndex: 'tags',
        width: '8%',
        sortable: false,
        render: (_value: string, record: ITicketListItem) => {
          if (!record.ticket_id) return null;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <TagManager
                entityId={record.ticket_id}
                entityType="ticket"
                initialTags={ticketTagsRef.current[record.ticket_id] || []}
                onTagsChange={(tags) => onTagsChange(record.ticket_id!, tags)}
                size={tagSize}
              />
            </div>
          );
        },
      }
    });
  }

  return columns.map(c => c.col);
}
