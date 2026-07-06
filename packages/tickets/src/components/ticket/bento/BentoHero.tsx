'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, SlidersHorizontal, Flame } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import UserAndTeamPicker, { type GetTeamAvatarUrlsBatch } from '@alga-psa/ui/components/UserAndTeamPicker';
import type { GetUserAvatarUrlsBatch } from '@alga-psa/ui/components/UserPicker';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { TagManager } from '@alga-psa/tags/components';
import type { ITag, ITicket, ITeam, ITicketResource, IUserWithRoles } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile } from '@alga-psa/ui/components/BentoTile';
import { FieldConflictBanner } from '@alga-psa/ui/presence/FieldConflictBanner';
import { computeSlaClocks, formatSlaLabel, type TicketSlaFields } from './slaClocks';
import type { TicketLiveConflictState } from '../ticketLiveFields';

interface HeroSelectOption {
  value: string;
  label: string;
  is_closed?: boolean;
  board_id?: string | null;
  color?: string | null;
}

interface BentoHeroProps {
  id: string;
  ticket: ITicket & TicketSlaFields & { escalated?: boolean; escalation_level?: number | null };
  statusOptions: HeroSelectOption[];
  priorityOptions: HeroSelectOption[];
  boardOptions: HeroSelectOption[];
  agentOptions: HeroSelectOption[];
  /** Full user objects backing the assignee picker (individual agents). */
  availableAgents: IUserWithRoles[];
  /** Teams selectable as the assignee (renders the assigned-team badge too). */
  teams?: ITeam[];
  /** Extra assigned agents; surfaced as a compact "+N" indicator. */
  additionalAgents?: ITicketResource[];
  /** Immediately reassigns the ticket to a team (server re-expands members). */
  onAssignTeam?: (teamId: string) => Promise<void> | void;
  /** Batch avatar loaders threaded to the assignee picker. */
  getUserAvatarUrlsBatch?: GetUserAvatarUrlsBatch;
  getTeamAvatarUrlsBatch?: GetTeamAvatarUrlsBatch;
  /** Opens the agent schedule drawer when an additional agent is clicked. */
  onAgentClick?: (userId: string) => void;
  onSelectChange: (field: keyof ITicket, newValue: string | null) => Promise<void> | void;
  /**
   * Coalesced multi-field save. Hero edits are buffered and debounced, then
   * flushed here as ONE combined update (one server write + one live broadcast
   * + one timeline row). Falls back to per-field onSelectChange when absent.
   */
  onBatchSelectChange?: (changes: Record<string, string | null>) => Promise<void> | void;
  responseStateTrackingEnabled?: boolean;
  hideSlaStatus?: boolean;
  /** Locks workflow fields when the ticket is a bundle child. */
  workflowLocked?: boolean;
  /** Opens the drawer hosting the full details form. */
  onOpenAllFields: () => void;
  // Tags
  tags?: ITag[];
  onTagsChange?: (tags: ITag[]) => void;
  /** Rendered create-task / link-task actions (injected node). */
  taskActions?: React.ReactNode;
  // Live collaboration signals (subset of the full TicketInfo treatment).
  liveHighlightedFields?: string[];
  liveFrozenFields?: string[];
  /** Per-field conflict state (someone else saved while this field was in play). */
  liveFieldConflicts?: Partial<Record<string, TicketLiveConflictState>>;
  /** Re-assert the local value for a conflicted field (dismisses the banner). */
  onKeepLiveConflict?: (field: string) => void;
  /** Accept the remote value for a conflicted field (dismisses the banner). */
  onTakeLiveConflict?: (field: string) => void;
  /** Display names of other users currently editing each field. */
  liveEditingUsers?: Partial<Record<string, string[]>>;
  /** Broadcasts which field this user is editing (null on blur). */
  onLiveEditingFieldChange?: (field: string | null) => void;
}

function HeroField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] mb-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Grid layout hero band: the fields a technician touches constantly, editable
 * in place (each control persists immediately through the existing
 * handleSelectChange pipeline). Everything else lives behind "All fields".
 */
export function BentoHero({
  id,
  ticket,
  statusOptions,
  priorityOptions,
  boardOptions,
  agentOptions,
  availableAgents,
  teams,
  additionalAgents,
  onAssignTeam,
  getUserAvatarUrlsBatch,
  getTeamAvatarUrlsBatch,
  onAgentClick,
  onSelectChange,
  onBatchSelectChange,
  responseStateTrackingEnabled,
  hideSlaStatus,
  workflowLocked,
  onOpenAllFields,
  tags,
  onTagsChange,
  taskActions,
  liveHighlightedFields = [],
  liveFrozenFields = [],
  liveFieldConflicts,
  onKeepLiveConflict,
  onTakeLiveConflict,
  liveEditingUsers,
  onLiveEditingFieldChange,
}: BentoHeroProps) {
  const { t } = useTranslation('features/tickets');
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // "Keep yours" on a live conflict re-saves the last value THIS user set for a
  // field (the remote value is already applied to `ticket`).
  const lastLocalEditRef = React.useRef<Record<string, string | null | undefined>>({});

  // --- Debounced coalescing (Task 3 / B) --------------------------------------
  // Rapid consecutive hero edits are buffered and flushed as ONE combined
  // update instead of a write + broadcast + timeline row per field. Two layers:
  //   - `pendingEdits`   : optimistic display overrides so a control reflects
  //                        the change instantly; cleared per-field once the real
  //                        `ticket` value lands (effect below), never eagerly.
  //   - `bufferRef`      : the not-yet-flushed changes; cleared on flush (sent).
  const [pendingEdits, setPendingEdits] = useState<Record<string, string | null>>({});
  const bufferRef = React.useRef<Record<string, string | null>>({});
  const flushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Displayed value for a field: the pending override (present even when null,
  // e.g. cleared due date / "no reply needed") wins over the persisted value.
  const displayValue = (field: keyof ITicket): string | null => {
    const key = field as string;
    if (key in pendingEdits) return pendingEdits[key];
    const raw = ticket[field] as unknown;
    return raw == null ? null : (raw as string);
  };

  const flushPending = React.useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const changes = bufferRef.current;
    bufferRef.current = {};
    if (Object.keys(changes).length === 0) return;
    if (onBatchSelectChange) {
      void onBatchSelectChange(changes);
    } else {
      // No batch handler wired: fall back to per-field immediate saves.
      for (const [field, value] of Object.entries(changes)) {
        void onSelectChange(field as keyof ITicket, value);
      }
    }
  }, [onBatchSelectChange, onSelectChange]);

  // Record a hero edit: remember it for F7 "Keep yours", show it optimistically,
  // buffer it, and (re)arm the debounce so a burst flushes as one update.
  const commitField = (field: keyof ITicket, value: string | null) => {
    lastLocalEditRef.current[field as string] = value;
    bufferRef.current = { ...bufferRef.current, [field as string]: value };
    setPendingEdits((prev) => ({ ...prev, [field as string]: value }));
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => flushPending(), 700);
  };

  // Drop each optimistic override exactly when the persisted `ticket` value
  // catches up to it — so the control never flickers back to the old value and
  // a stale override never lingers.
  useEffect(() => {
    setPendingEdits((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const key of keys) {
        const raw = ticket[key as keyof ITicket] as unknown;
        const ticketValue = raw == null ? null : (raw as string);
        if (ticketValue === prev[key]) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [ticket]);

  // A live conflict (F7) supersedes any buffered/optimistic local edit for that
  // field: refreshTicketSnapshot has already written the authoritative remote
  // value into `ticket`, and the user now resolves via the Keep/Take banner
  // (backed by lastLocalEditRef, not pendingEdits). Drop the override so "Take
  // theirs" isn't masked by a stale local value, and drop it from the buffer so
  // a not-yet-flushed edit can't silently re-clobber the remote value.
  useEffect(() => {
    const conflicted = liveFieldConflicts ? Object.keys(liveFieldConflicts) : [];
    if (conflicted.length === 0) return;
    for (const field of conflicted) {
      if (field in bufferRef.current) {
        const nextBuffer = { ...bufferRef.current };
        delete nextBuffer[field];
        bufferRef.current = nextBuffer;
      }
    }
    setPendingEdits((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const field of conflicted) {
        if (field in next) {
          delete next[field];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [liveFieldConflicts]);

  // Never lose a buffered edit: flush on unmount and when focus leaves the hero.
  const flushPendingRef = React.useRef(flushPending);
  useEffect(() => {
    flushPendingRef.current = flushPending;
  }, [flushPending]);
  useEffect(() => {
    return () => flushPendingRef.current();
  }, []);
  const handleHeroBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      flushPending();
    }
  };

  const [titleDraft, setTitleDraft] = useState(ticket.title ?? '');

  const responseStateOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'awaiting_internal', label: t('bento.hero.responseWaitingOnUs', 'Waiting on us') },
      { value: 'awaiting_client', label: t('bento.hero.responseWaitingOnClient', 'Waiting on client') },
      { value: 'none', label: t('bento.hero.responseNone', 'No reply needed') },
    ],
    [t],
  );

  // The title reflects its pending override while a save is in flight, so the
  // draft (re)opens on whatever is currently shown, not the stale persisted one.
  const displayedTitle = displayValue('title') ?? '';
  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(displayedTitle);
  }, [displayedTitle, isEditingTitle]);

  const isFrozen = (field: string) => liveFrozenFields.includes(field);
  const fieldWrapClass = (field: string) =>
    liveHighlightedFields.includes(field)
      ? 'rounded-md ring-2 ring-[rgb(var(--color-primary-300))] transition-shadow'
      : '';

  // Ticket statuses are board-scoped. Match legacy TicketInfo (which fetches
  // getTicketStatuses(boardId) — strictly board_id = boardId) and offer only
  // this board's statuses. We intentionally drop the old `!option.board_id`
  // inclusion: board-less statuses (project/global standard statuses) were
  // leaking into the dropdown. The ticket's current status is always kept so
  // switching to a board whose statuses are still board-less can't blank it.
  const scopedStatusOptions = useMemo(
    () =>
      statusOptions.filter(
        (option) =>
          option.board_id === ticket.board_id || option.value === ticket.status_id,
      ),
    [statusOptions, ticket.board_id, ticket.status_id],
  );

  // Priority options may carry the priority color; render it as a dot.
  const priorityJsxOptions = useMemo<SelectOption[]>(
    () =>
      priorityOptions
        .filter((option) => option.value !== 'all')
        .map((option) => ({
          value: option.value,
          textValue: option.label,
          label: (
            <span className="inline-flex items-center gap-2 min-w-0">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: option.color || 'rgb(var(--color-border-400))' }}
              />
              <span className="truncate">{option.label}</span>
            </span>
          ),
        })),
    [priorityOptions],
  );

  // The team currently assigned to the ticket, resolved from the teams pool so
  // the picker can sit beside a compact team badge (mirrors the legacy layout).
  const assignedTeam = useMemo(
    () => (ticket.assigned_team_id ? teams?.find((team) => team.team_id === ticket.assigned_team_id) ?? null : null),
    [teams, ticket.assigned_team_id],
  );

  // Extra assigned agents are surfaced as a "+N" indicator; resolve each name
  // from the full agent pool (the resource rows only carry the user id).
  const additionalAgentEntries = useMemo(
    () =>
      (additionalAgents ?? [])
        .filter((agent) => agent.additional_user_id)
        .map((agent) => {
          const user = availableAgents.find((candidate) => candidate.user_id === agent.additional_user_id);
          const name = user
            ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || t('bento.hero.unknownAgent', 'Unknown agent')
            : t('bento.hero.unknownAgent', 'Unknown agent');
          return { userId: agent.additional_user_id as string, name };
        }),
    [additionalAgents, availableAgents, t],
  );

  const dueRaw = displayValue('due_date');
  const dueDate = dueRaw ? new Date(dueRaw as unknown as string) : undefined;

  const handleDueDateChange = (date: Date | undefined) => {
    if (!date) {
      void commitField('due_date', null);
      return;
    }
    // Preserve the existing time-of-day when only the date changes.
    const next = new Date(date);
    if (dueDate && !Number.isNaN(dueDate.getTime())) {
      next.setHours(dueDate.getHours(), dueDate.getMinutes(), 0, 0);
    }
    void commitField('due_date', next.toISOString());
  };

  // Re-derive the SLA countdown once a minute so "2h left" doesn't go stale
  // while the screen sits open (mirrors SlaClocksTile).
  const [slaTick, setSlaTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setSlaTick((n) => n + 1), 60_000);
    return () => clearInterval(interval);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const slaClocks = useMemo(() => computeSlaClocks(ticket), [ticket, slaTick]);

  const committingTitleRef = React.useRef(false);
  const commitTitle = async () => {
    // Enter calls this, which unmounts the input and fires onBlur → a second
    // call; guard so the title is only submitted once.
    if (committingTitleRef.current) return;
    committingTitleRef.current = true;
    setIsEditingTitle(false);
    const next = titleDraft.trim();
    try {
      if (next && next !== displayedTitle) {
        commitField('title', next);
      } else {
        setTitleDraft(displayedTitle);
      }
    } finally {
      committingTitleRef.current = false;
    }
  };

  // --- Live edit presence + conflict helpers (ported from TicketInfo) ---
  const editingUsersFor = (field: string) => liveEditingUsers?.[field] ?? [];
  const isRemotelyEdited = (field: string) => editingUsersFor(field).length > 0;

  const editingCaption = (field: string): string | null => {
    const users = editingUsersFor(field);
    if (users.length === 0) return null;
    if (users.length === 1) {
      return t('liveUpdates.editing.single', '{{name}} is editing').replace('{{name}}', users[0]);
    }
    return t(
      users.length === 2 ? 'liveUpdates.editing.multiple_one' : 'liveUpdates.editing.multiple_other',
      users.length === 2
        ? '{{name}} and {{count}} other are editing'
        : '{{name}} and {{count}} others are editing',
    )
      .replace('{{name}}', users[0])
      .replace('{{count}}', String(users.length - 1));
  };

  // Report which field this user is editing (focus in / blur out of its cell).
  const editHandlers = (field: string) => ({
    onFocusCapture: () => onLiveEditingFieldChange?.(field),
    onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        onLiveEditingFieldChange?.(null);
      }
    },
  });

  // Resolve the human-readable remote value for the conflict banner, using the
  // hero's already-present option lists. Only the hero fields are handled.
  const getConflictRemoteValue = (field: string): React.ReactNode => {
    switch (field) {
      case 'title':
        return ticket.title || t('properties.notAvailable', 'N/A');
      case 'status_id':
        return scopedStatusOptions.find((option) => option.value === ticket.status_id)?.label
          ?? t('properties.notAvailable', 'N/A');
      case 'priority_id':
        return priorityOptions.find((option) => option.value === ticket.priority_id)?.label
          ?? t('properties.notAvailable', 'N/A');
      case 'board_id':
        return boardOptions.find((option) => option.value === ticket.board_id)?.label
          ?? t('properties.notAvailable', 'N/A');
      case 'assigned_to': {
        const agent = availableAgents.find((user) => user.user_id === ticket.assigned_to);
        return agent
          ? `${agent.first_name ?? ''} ${agent.last_name ?? ''}`.trim() || t('bento.hero.notAssigned', 'Not assigned')
          : t('bento.hero.notAssigned', 'Not assigned');
      }
      case 'due_date':
        return (ticket.due_date as unknown as string) ?? t('properties.notAvailable', 'N/A');
      case 'response_state': {
        const value = (ticket.response_state as string | null) ?? 'none';
        return responseStateOptions.find((option) => option.value === value)?.label
          ?? t('properties.notAvailable', 'N/A');
      }
      default:
        return t('properties.notAvailable', 'N/A');
    }
  };

  // "Keep yours": re-save the last value this user set for the field (the remote
  // value is already applied to `ticket`), then dismiss the banner.
  const keepMine = (field: string) => {
    const mine = lastLocalEditRef.current[field];
    if (mine !== undefined) void onSelectChange(field as keyof ITicket, mine);
    onKeepLiveConflict?.(field);
  };

  // Wraps a hero control with edit-presence reporting, a remote-edit dim, an
  // "N is editing" caption, and the Keep/Take conflict banner. A plain render
  // helper (not a component) so the control isn't remounted each render.
  const renderLiveField = (field: string, wrapClassName: string, control: React.ReactNode) => {
    const conflict = liveFieldConflicts?.[field];
    const caption = editingCaption(field);
    return (
      <div {...editHandlers(field)}>
        <div
          className={`transition-opacity ${isRemotelyEdited(field) ? 'opacity-60' : ''} ${fieldWrapClass(field)} ${wrapClassName}`.trim()}
        >
          {control}
        </div>
        {caption ? (
          <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{caption}</p>
        ) : null}
        {conflict ? (
          <FieldConflictBanner
            remoteAuthor={conflict.updatedBy.displayName}
            remoteAt={conflict.updatedAt}
            remoteValue={getConflictRemoteValue(field)}
            onKeepYours={() => keepMine(field)}
            onTakeTheirs={() => onTakeLiveConflict?.(field)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <BentoTile id={id}>
      <div onBlurCapture={handleHeroBlurCapture}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1" {...editHandlers('title')}>
            <div className={`transition-opacity ${isRemotelyEdited('title') ? 'opacity-60' : ''}`.trim()}>
              {isEditingTitle ? (
                <Input
                  id={`${id}-title-input`}
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitTitle();
                    if (event.key === 'Escape') {
                      setTitleDraft(displayedTitle);
                      setIsEditingTitle(false);
                    }
                  }}
                  autoFocus
                  className="text-lg font-bold"
                  containerClassName="mb-0"
                />
              ) : (
                <h2 className="text-lg font-bold text-[rgb(var(--color-text-900))] flex items-center gap-2 min-w-0">
                  <span className="truncate">{displayedTitle}</span>
                  <button
                    id={`${id}-title-edit`}
                    type="button"
                    aria-label={t('bento.hero.editTitle', 'Edit title')}
                    className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))] flex-shrink-0"
                    onClick={() => setIsEditingTitle(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </h2>
              )}
            </div>
            {editingCaption('title') ? (
              <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{editingCaption('title')}</p>
            ) : null}
            {liveFieldConflicts?.['title'] ? (
              <FieldConflictBanner
                remoteAuthor={liveFieldConflicts['title']!.updatedBy.displayName}
                remoteAt={liveFieldConflicts['title']!.updatedAt}
                remoteValue={getConflictRemoteValue('title')}
                onKeepYours={() => keepMine('title')}
                onTakeTheirs={() => onTakeLiveConflict?.('title')}
              />
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {ticket.escalated ? (
              <span
                id={`${id}-escalated-chip`}
                className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-800 dark:text-red-300"
              >
                <Flame className="h-3 w-3" />
                {t('bento.hero.escalated', 'Escalated')}{typeof ticket.escalation_level === 'number' && ticket.escalation_level > 0 ? ` · L${ticket.escalation_level}` : ''}
              </span>
            ) : null}
            {!hideSlaStatus && slaClocks.policyApplied ? (
              <span
                id={`${id}-sla-slab`}
                className="text-xs font-medium text-[rgb(var(--color-text-500))]"
              >
                {t('bento.hero.resolutionSla', 'Resolution SLA:')}{' '}
                <span
                  className={
                    slaClocks.resolution.state === 'overdue' || slaClocks.resolution.state === 'missed'
                      ? 'font-semibold text-red-700 dark:text-red-400'
                      : slaClocks.resolution.state === 'met'
                        ? 'font-semibold text-green-700 dark:text-green-400'
                        : 'font-semibold text-amber-700 dark:text-amber-400'
                  }
                >
                  {formatSlaLabel(slaClocks.resolution.label, t)}
                </span>
              </span>
            ) : null}
            {taskActions}
            <Button
              id={`${id}-all-fields-button`}
              variant="outline"
              size="sm"
              onClick={onOpenAllFields}
              className="flex items-center gap-1.5"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t('bento.hero.allFields', 'All fields')}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <HeroField label={t('bento.hero.status', 'Status')}>
            {renderLiveField('status_id', '', (
              <CustomSelect
                id={`${id}-status-select`}
                placeholder={t('bento.hero.status', 'Status')}
                value={displayValue('status_id') ?? ''}
                options={scopedStatusOptions}
                onValueChange={(value: string) => void commitField('status_id', value)}
                disabled={workflowLocked || isFrozen('status_id')}
                className="!w-full"
              />
            ))}
          </HeroField>
          <HeroField label={t('bento.hero.priority', 'Priority')}>
            {renderLiveField('priority_id', '', (
              <CustomSelect
                id={`${id}-priority-select`}
                placeholder={t('bento.hero.priority', 'Priority')}
                value={displayValue('priority_id') ?? ''}
                options={priorityJsxOptions}
                onValueChange={(value: string) => void commitField('priority_id', value)}
                disabled={workflowLocked || isFrozen('priority_id')}
                className="!w-full"
              />
            ))}
          </HeroField>
          <HeroField label={t('bento.hero.board', 'Board')}>
            {renderLiveField('board_id', '', (
              <CustomSelect
                id={`${id}-board-select`}
                placeholder={t('bento.hero.board', 'Board')}
                value={displayValue('board_id') ?? ''}
                options={boardOptions}
                onValueChange={(value: string) => void commitField('board_id', value)}
                disabled={workflowLocked || isFrozen('board_id')}
                className="!w-full"
              />
            ))}
          </HeroField>
          <HeroField label={t('bento.hero.assignedTo', 'Assigned to')}>
            {renderLiveField('assigned_to', 'flex items-center gap-1.5 flex-wrap', (
              <>
              <UserAndTeamPicker
                id={`${id}-assignee-picker`}
                value={displayValue('assigned_to') ?? ''}
                onValueChange={(value) => void commitField('assigned_to', value)}
                onTeamSelect={async (teamId) => {
                  await onAssignTeam?.(teamId);
                }}
                users={availableAgents}
                teams={teams ?? []}
                getUserAvatarUrlsBatch={getUserAvatarUrlsBatch}
                getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatch}
                labelStyle="none"
                buttonWidth="fit"
                size="sm"
                placeholder={t('bento.hero.notAssigned', 'Not assigned')}
                disabled={workflowLocked || isFrozen('assigned_to')}
              />
              {assignedTeam ? (
                <Tooltip content={assignedTeam.team_name}>
                  <Badge variant="info" size="sm" className="gap-1 cursor-help">
                    <TeamAvatar
                      teamId={assignedTeam.team_id}
                      teamName={assignedTeam.team_name}
                      avatarUrl={null}
                      size="xs"
                    />
                  </Badge>
                </Tooltip>
              ) : null}
              {additionalAgentEntries.length > 0 ? (
                <Tooltip
                  content={
                    <div className="text-xs space-y-1.5">
                      <div className="font-medium text-gray-300 mb-1">
                        {t('bento.hero.additionalAgentsTooltip', 'Additional agents:')}
                      </div>
                      {additionalAgentEntries.map((agent) => (
                        <div key={agent.userId} className="flex items-center gap-2">
                          <UserAvatar userId={agent.userId} userName={agent.name} avatarUrl={null} size="xs" />
                          <span>{agent.name}</span>
                        </div>
                      ))}
                    </div>
                  }
                >
                  <Badge
                    variant="info"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => {
                      const first = additionalAgentEntries[0];
                      if (first) onAgentClick?.(first.userId);
                    }}
                  >
                    +{additionalAgentEntries.length}
                  </Badge>
                </Tooltip>
              ) : null}
              </>
            ))}
          </HeroField>
          <HeroField label={t('bento.hero.due', 'Due')}>
            {renderLiveField('due_date', '', (
              <DatePicker
                id={`${id}-due-date-picker`}
                value={dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : undefined}
                onChange={handleDueDateChange}
                placeholder={t('bento.hero.noDueDate', 'No due date')}
                disabled={isFrozen('due_date')}
              />
            ))}
          </HeroField>
          {responseStateTrackingEnabled ? (
            <HeroField label={t('bento.hero.replyStatus', 'Reply status')}>
              {renderLiveField('response_state', '', (
                <CustomSelect
                  id={`${id}-response-state-select`}
                  placeholder={t('bento.hero.replyStatus', 'Reply status')}
                  value={displayValue('response_state') ?? 'none'}
                  options={responseStateOptions}
                  onValueChange={(value: string) =>
                    void commitField('response_state', value === 'none' ? null : value)
                  }
                  disabled={isFrozen('response_state')}
                  className="!w-full"
                />
              ))}
            </HeroField>
          ) : null}
        </div>

        {ticket.ticket_id && onTagsChange ? (
          <div id={`${id}-tags-row`} className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
              {t('bento.hero.tags', 'Tags')}
            </span>
            <TagManager
              entityId={ticket.ticket_id}
              entityType="ticket"
              initialTags={tags ?? []}
              onTagsChange={onTagsChange}
              useInlineInput
            />
          </div>
        ) : null}
      </div>
    </BentoTile>
  );
}

export default BentoHero;
