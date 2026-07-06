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
  const [titleDraft, setTitleDraft] = useState(ticket.title ?? '');

  // The bento saves each field immediately, so there is no pending edit to
  // revert on conflict — instead we remember the last value this user set per
  // field so "Keep yours" can re-save it over the remote change.
  const lastLocalEditRef = React.useRef<Record<string, string | null | undefined>>({});
  const commitField = (field: keyof ITicket, value: string | null) => {
    lastLocalEditRef.current[field as string] = value;
    return onSelectChange(field, value);
  };

  const responseStateOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'awaiting_internal', label: t('bento.hero.responseWaitingOnUs', 'Waiting on us') },
      { value: 'awaiting_client', label: t('bento.hero.responseWaitingOnClient', 'Waiting on client') },
      { value: 'none', label: t('bento.hero.responseNone', 'No reply needed') },
    ],
    [t],
  );

  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(ticket.title ?? '');
  }, [ticket.title, isEditingTitle]);

  const isFrozen = (field: string) => liveFrozenFields.includes(field);
  const fieldWrapClass = (field: string) =>
    liveHighlightedFields.includes(field)
      ? 'rounded-md ring-2 ring-[rgb(var(--color-primary-300))] transition-shadow'
      : '';

  // Statuses are board-scoped in the options payload; only offer the ones
  // that belong to this ticket's board (plus unscoped statuses).
  const scopedStatusOptions = useMemo(
    () =>
      statusOptions.filter(
        (option) => !option.board_id || option.board_id === ticket.board_id,
      ),
    [statusOptions, ticket.board_id],
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

  const dueDate = ticket.due_date ? new Date(ticket.due_date as unknown as string) : undefined;

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
      if (next && next !== ticket.title) {
        await commitField('title', next);
      } else {
        setTitleDraft(ticket.title ?? '');
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
      <div>
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
                      setTitleDraft(ticket.title ?? '');
                      setIsEditingTitle(false);
                    }
                  }}
                  autoFocus
                  className="text-lg font-bold"
                  containerClassName="mb-0"
                />
              ) : (
                <h2 className="text-lg font-bold text-[rgb(var(--color-text-900))] flex items-center gap-2 min-w-0">
                  <span className="truncate">{ticket.title}</span>
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
                value={ticket.status_id ?? ''}
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
                value={ticket.priority_id ?? ''}
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
                value={ticket.board_id ?? ''}
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
                value={ticket.assigned_to ?? ''}
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
                  value={(ticket.response_state as string | null) ?? 'none'}
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
