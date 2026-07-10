'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, SlidersHorizontal, Flame, Save } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import UserAndTeamPicker, { type GetTeamAvatarUrlsBatch } from '@alga-psa/ui/components/UserAndTeamPicker';
import type { GetUserAvatarUrlsBatch } from '@alga-psa/ui/components/UserPicker';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { TagManager } from '@alga-psa/tags/components';
import type { ITag, ITicket, ITeam, ITicketResource, IUserWithRoles } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile } from '@alga-psa/ui/components/bento/BentoTile';
import { FieldConflictBanner } from '@alga-psa/ui/presence/FieldConflictBanner';
import { computeSlaClocks, formatSlaLabel, type TicketSlaFields } from './slaClocks';
import { useTeamAvatarUrl } from './useTeamAvatarUrl';
import type { TicketLiveConflictState } from '../ticketLiveFields';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getTicketCategoriesByBoard, type BoardCategoryData } from '../../../actions/ticketCategoryActions';
import { useRegisterUnsavedChanges } from '@alga-psa/ui/context';
import { usePageSaveShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from '../TicketNotificationSuppressionControl';

interface HeroSelectOption {
  value: string;
  label: string;
  is_closed?: boolean;
  board_id?: string | null;
  color?: string | null;
}

type HeroPendingChanges = Record<string, string | null>;

const trackedHeroFields = [
  'title',
  'status_id',
  'priority_id',
  'board_id',
  'category_id',
  'subcategory_id',
  'assigned_to',
  'due_date',
  'response_state',
] as const;

const defaultNotificationSuppression = (): TicketNotificationSuppressionValue => ({
  suppressContactNotifications: false,
  suppressInternalNotifications: false,
});

interface BentoHeroProps {
  id: string;
  /** Observed by TicketDetails' sticky header to float the title on scroll. */
  titleRef?: React.Ref<HTMLHeadingElement>;
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
   * Coalesced multi-field save. Hero edits are buffered as a pending diff and
   * flushed here on explicit Save as ONE combined update (one server write +
   * one live broadcast + one timeline row). Falls back to per-field
   * onSelectChange when absent.
   */
  onBatchSelectChange?: (
    changes: Record<string, string | null>,
    options?: TicketNotificationSuppressionValue
  ) => Promise<boolean | void> | boolean | void;
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
  /** Reports locally dirty hero fields for live update conflict/highlight filtering. */
  onLiveDirtyFieldsChange?: (fields: string[]) => void;
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
 * in place. Edits buffer into a pending diff and persist together via the
 * Save Changes bar (mirroring the entry hero). Everything else lives behind
 * "All fields".
 */
export function BentoHero({
  id,
  titleRef,
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
  onLiveDirtyFieldsChange,
}: BentoHeroProps) {
  const { t } = useTranslation('features/tickets');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [notificationSuppression, setNotificationSuppression] =
    useState<TicketNotificationSuppressionValue>(() => defaultNotificationSuppression());
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Keep yours" on a live conflict re-saves the last value THIS user set for a
  // field (the remote value is already applied to `ticket`).
  const lastLocalEditRef = React.useRef<Record<string, string | null | undefined>>({});

  const buildOriginalTicketValues = useCallback((): HeroPendingChanges => {
    const values: HeroPendingChanges = {};
    for (const field of trackedHeroFields) {
      const raw = ticket[field as keyof ITicket] as unknown;
      values[field] = raw == null ? null : (raw as string);
    }
    return values;
  }, [ticket]);

  const [originalTicketValues, setOriginalTicketValues] = useState<HeroPendingChanges>(() => buildOriginalTicketValues());
  const [pendingChanges, setPendingChanges] = useState<HeroPendingChanges>({});
  const hasUnsavedChanges = Object.keys(pendingChanges).length > 0;
  const hasActiveLiveConflict = Boolean(liveFieldConflicts && Object.keys(liveFieldConflicts).length > 0);

  useRegisterUnsavedChanges(`ticket-bento-hero-${id}`, hasUnsavedChanges);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setOriginalTicketValues(buildOriginalTicketValues());
    }
  }, [buildOriginalTicketValues, hasUnsavedChanges]);

  useEffect(() => {
    onLiveDirtyFieldsChange?.(Object.keys(pendingChanges));
  }, [onLiveDirtyFieldsChange, pendingChanges]);

  useEffect(() => {
    return () => {
      onLiveDirtyFieldsChange?.([]);
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
    };
  }, [onLiveDirtyFieldsChange]);

  // Displayed value for a field: the pending override (present even when null,
  // e.g. cleared due date / "no reply needed") wins over the persisted value.
  const displayValue = (field: keyof ITicket): string | null => {
    const key = field as string;
    if (key in pendingChanges) return pendingChanges[key];
    const raw = ticket[field] as unknown;
    return raw == null ? null : (raw as string);
  };

  const handlePendingChange = useCallback((field: keyof ITicket, value: string | null) => {
    const key = field as string;
    lastLocalEditRef.current[field as string] = value;
    setPendingChanges((prev) => {
      const originalValue = originalTicketValues[key] ?? null;
      if (value === originalValue) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: value };
    });
  }, [originalTicketValues]);

  // A live conflict (F7) supersedes any buffered/optimistic local edit for that
  // field: refreshTicketSnapshot has already written the authoritative remote
  // value into `ticket`, and the user now resolves via the Keep/Take banner
  // (backed by lastLocalEditRef, not pendingEdits). Drop the override so "Take
  // theirs" isn't masked by a stale local value, and drop it from the buffer so
  // a not-yet-flushed edit can't silently re-clobber the remote value.
  useEffect(() => {
    const conflicted = liveFieldConflicts ? Object.keys(liveFieldConflicts) : [];
    if (conflicted.length === 0) return;
    setPendingChanges((prev) => {
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

  const effectiveBoardId = displayValue('board_id');
  const [boardScopedStatusOptions, setBoardScopedStatusOptions] = useState<HeroSelectOption[]>(() =>
    statusOptions.filter((option) => option.board_id === ticket.board_id || option.value === ticket.status_id),
  );
  const [boardCategories, setBoardCategories] = useState<BoardCategoryData['categories']>([]);
  const [savedBoardConfig, setSavedBoardConfig] = useState<BoardCategoryData['boardConfig'] | null>(null);
  const [pendingBoardConfig, setPendingBoardConfig] = useState<BoardCategoryData['boardConfig'] | null>(null);
  const [isLoadingStatusOptions, setIsLoadingStatusOptions] = useState(false);
  const [isLoadingBoardConfig, setIsLoadingBoardConfig] = useState(false);
  const fetchingBoardIdRef = useRef<string | null>(null);
  const ignoredPriorityResetBoardRef = useRef<string | null>(null);

  const requiresDestinationStatusSelection = Boolean(
    pendingChanges.board_id
      && pendingChanges.board_id !== originalTicketValues.board_id
      && !pendingChanges.status_id,
  );

  useEffect(() => {
    let isMounted = true;

    const loadBoardStatuses = async () => {
      if (!effectiveBoardId) {
        setBoardScopedStatusOptions([]);
        return;
      }

      setIsLoadingStatusOptions(true);
      try {
        const statuses = await getTicketStatuses(effectiveBoardId);
        if (!isMounted) return;
        setBoardScopedStatusOptions(
          statuses.map((status) => ({
            value: status.status_id,
            label: status.name ?? '',
            is_closed: status.is_closed,
            board_id: effectiveBoardId,
          })),
        );
      } catch (error) {
        console.error('[BentoHero] Failed to load board statuses:', error);
        if (isMounted) {
          setBoardScopedStatusOptions([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingStatusOptions(false);
        }
      }
    };

    loadBoardStatuses();

    return () => {
      isMounted = false;
    };
  }, [effectiveBoardId]);

  useEffect(() => {
    let isMounted = true;

    const loadBoardCategories = async () => {
      if (!effectiveBoardId) {
        setBoardCategories([]);
        setPendingBoardConfig(null);
        return;
      }

      fetchingBoardIdRef.current = effectiveBoardId;
      setIsLoadingBoardConfig(true);
      try {
        const data = await getTicketCategoriesByBoard(effectiveBoardId);
        if (!isMounted || fetchingBoardIdRef.current !== effectiveBoardId) return;
        const categories = Array.isArray(data.categories) ? data.categories : [];
        setBoardCategories(categories);
        if (effectiveBoardId === ticket.board_id) {
          setSavedBoardConfig(data.boardConfig);
          setPendingBoardConfig(null);
        } else {
          setPendingBoardConfig(data.boardConfig);
        }
      } catch (error) {
        console.error('[BentoHero] Failed to load board categories:', error);
        if (isMounted) {
          setBoardCategories([]);
          if (effectiveBoardId !== ticket.board_id) {
            setPendingBoardConfig(null);
          }
        }
      } finally {
        if (isMounted) {
          setIsLoadingBoardConfig(false);
        }
      }
    };

    loadBoardCategories();

    return () => {
      isMounted = false;
    };
  }, [effectiveBoardId, ticket.board_id]);

  useEffect(() => {
    if (!pendingChanges.board_id || !pendingBoardConfig || !savedBoardConfig) {
      return;
    }

    if (ignoredPriorityResetBoardRef.current === pendingChanges.board_id) {
      return;
    }

    if (savedBoardConfig.priority_type !== pendingBoardConfig.priority_type) {
      handlePendingChange('priority_id', null);
    }
  }, [handlePendingChange, pendingBoardConfig, pendingChanges.board_id, savedBoardConfig]);

  const displayedStatusId = displayValue('status_id');
  const baseScopedStatusOptions = boardScopedStatusOptions.length > 0
    ? boardScopedStatusOptions
    : statusOptions.filter((option) => option.board_id === effectiveBoardId || option.value === displayedStatusId);
  // The displayed status must stay in the list even when the board fetch
  // returns only board-scoped rows (global/legacy statuses live on no board);
  // otherwise the select renders blank for a perfectly valid ticket.
  const scopedStatusOptions =
    displayedStatusId && !baseScopedStatusOptions.some((option) => option.value === displayedStatusId)
      ? [...baseScopedStatusOptions, ...statusOptions.filter((option) => option.value === displayedStatusId)]
      : baseScopedStatusOptions;

  const categoryOptions = useMemo<SelectOption[]>(
    () =>
      (boardCategories ?? [])
        .filter((category) => category.category_id)
        .map((category) => ({
          value: category.category_id,
          label: category.category_name ?? '',
        })),
    [boardCategories],
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
  const assignedTeamAvatarUrl = useTeamAvatarUrl(assignedTeam?.team_id, assignedTeam?.tenant, getTeamAvatarUrlsBatch);

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
      handlePendingChange('due_date', null);
      return;
    }
    // Preserve the existing time-of-day when only the date changes.
    const next = new Date(date);
    if (dueDate && !Number.isNaN(dueDate.getTime())) {
      next.setHours(dueDate.getHours(), dueDate.getMinutes(), 0, 0);
    }
    handlePendingChange('due_date', next.toISOString());
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
        handlePendingChange('title', next);
      } else {
        setTitleDraft(displayedTitle);
      }
    } finally {
      committingTitleRef.current = false;
    }
  };

  const handleBoardChange = useCallback((value: string) => {
    ignoredPriorityResetBoardRef.current = null;
    handlePendingChange('board_id', value);
    if (value === (originalTicketValues.board_id ?? null)) {
      // Returning to the saved board: drop the board-driven overrides instead
      // of leaving cleared values staged — {status_id: null} with no pending
      // board would pass the destination-status gate yet always fail to save.
      // Must read the latest staged state (not this render's closure): the
      // async priority-type reset may have staged priority_id in a commit
      // this handler's render never saw.
      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next.status_id;
        delete next.category_id;
        delete next.subcategory_id;
        if (next.priority_id === null) {
          delete next.priority_id;
        }
        return next;
      });
    } else {
      handlePendingChange('status_id', null);
      handlePendingChange('category_id', null);
      handlePendingChange('subcategory_id', null);
    }
  }, [handlePendingChange, originalTicketValues]);

  const handleSaveChanges = useCallback(async () => {
    if (!hasUnsavedChanges || requiresDestinationStatusSelection || hasActiveLiveConflict) {
      return;
    }

    setIsSaving(true);
    try {
      const changes = { ...pendingChanges };
      const saveOptions = notificationSuppression.suppressContactNotifications
        ? notificationSuppression
        : undefined;

      if (onBatchSelectChange) {
        const result = saveOptions
          ? await onBatchSelectChange(changes, saveOptions)
          : await onBatchSelectChange(changes);
        if (result === false) {
          return;
        }
      } else {
        for (const [field, value] of Object.entries(changes)) {
          await onSelectChange(field as keyof ITicket, value);
        }
      }

      setOriginalTicketValues((prev) => ({ ...prev, ...changes }));
      setPendingChanges({});
      setNotificationSuppression(defaultNotificationSuppression());
      setIsEditingTitle(false);
      setSaveSuccess(true);
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
      saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('[BentoHero] Failed to save hero changes:', error);
    } finally {
      setIsSaving(false);
    }
  }, [
    hasActiveLiveConflict,
    hasUnsavedChanges,
    notificationSuppression,
    onBatchSelectChange,
    onSelectChange,
    pendingChanges,
    requiresDestinationStatusSelection,
  ]);

  usePageSaveShortcut(handleSaveChanges, {
    enabled: hasUnsavedChanges && !requiresDestinationStatusSelection && !hasActiveLiveConflict && !isSaving,
  });

  const resetPendingChanges = useCallback(() => {
    setPendingChanges({});
    setTitleDraft(ticket.title ?? '');
    setIsEditingTitle(false);
    setNotificationSuppression(defaultNotificationSuppression());
    setShowCancelConfirm(false);
  }, [ticket.title]);

  const handleCancelClick = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowCancelConfirm(true);
      return;
    }
    resetPendingChanges();
  }, [hasUnsavedChanges, resetPendingChanges]);

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

  const takeTheirs = (field: string) => {
    if (field === 'board_id') {
      ignoredPriorityResetBoardRef.current = pendingChanges.board_id ?? null;
      fetchingBoardIdRef.current = ticket.board_id ?? null;
      setPendingBoardConfig(null);
      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next.board_id;
        delete next.status_id;
        delete next.category_id;
        delete next.subcategory_id;
        delete next.priority_id;
        return next;
      });
    }
    onTakeLiveConflict?.(field);
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
            onTakeTheirs={() => takeTheirs(field)}
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
                      setTitleDraft(displayedTitle);
                      setIsEditingTitle(false);
                    }
                  }}
                  autoFocus
                  className="text-lg font-bold"
                  containerClassName="mb-0"
                />
              ) : (
                <h2 ref={titleRef} className="text-lg font-bold text-[rgb(var(--color-text-900))] flex items-center gap-2 min-w-0">
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
                onTakeTheirs={() => takeTheirs('title')}
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

        {requiresDestinationStatusSelection ? (
          <Alert id={`${id}-destination-status-warning`} variant="warning" className="mt-3">
            <AlertDescription>
              {t('bento.hero.selectDestinationStatus', 'Select a status for the new board before saving.')}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <HeroField label={t('bento.hero.status', 'Status')}>
            {renderLiveField('status_id', '', (
              <CustomSelect
                id={`${id}-status-select`}
                placeholder={t('bento.hero.status', 'Status')}
                value={displayValue('status_id') ?? ''}
                options={scopedStatusOptions}
                onValueChange={(value: string) => handlePendingChange('status_id', value)}
                disabled={workflowLocked || isFrozen('status_id') || isLoadingStatusOptions}
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
                onValueChange={(value: string) => handlePendingChange('priority_id', value)}
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
                onValueChange={handleBoardChange}
                disabled={workflowLocked || isFrozen('board_id')}
                className="!w-full"
              />
            ))}
          </HeroField>
          <HeroField label={t('bento.hero.category', 'Category')}>
            {renderLiveField('category_id', '', (
              <CustomSelect
                id={`${id}-category-select`}
                placeholder={t('bento.hero.category', 'Category')}
                value={displayValue('category_id') ?? ''}
                options={categoryOptions}
                onValueChange={(value: string) => handlePendingChange('category_id', value || null)}
                disabled={workflowLocked || isFrozen('category_id') || isLoadingBoardConfig}
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
                onValueChange={(value) => handlePendingChange('assigned_to', value)}
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
                      avatarUrl={assignedTeamAvatarUrl}
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
                    handlePendingChange('response_state', value === 'none' ? null : value)
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

        {hasUnsavedChanges ? (
          <div
            id={`${id}-save-bar`}
            className="mt-4 flex flex-wrap items-center gap-3 border-t border-[rgb(var(--color-border-200))] pt-3"
          >
            <TicketNotificationSuppressionControl
              idPrefix={`${id}-save-bar`}
              value={notificationSuppression}
              onChange={setNotificationSuppression}
              disabled={isSaving}
              className="min-w-[260px]"
            />
            {saveSuccess ? (
              <span className="text-sm text-green-700">{t('info.saved', 'Saved')}</span>
            ) : null}
            <div className="flex-1" />
            <Button
              id={`${id}-cancel-btn`}
              type="button"
              variant="outline"
              onClick={handleCancelClick}
              disabled={isSaving}
            >
              {t('actions.cancel', 'Cancel')}
            </Button>
            <Button
              id={`${id}-save-changes-btn`}
              type="button"
              onClick={handleSaveChanges}
              disabled={isSaving || requiresDestinationStatusSelection || hasActiveLiveConflict}
            >
              <span className="font-bold">
                {isSaving
                  ? t('info.saving', 'Saving...')
                  : `${t('info.saveChanges', 'Save Changes')} *`}
              </span>
              {!isSaving ? <Save className="ml-2 h-4 w-4" /> : null}
            </Button>
          </div>
        ) : null}
        {hasActiveLiveConflict ? (
          <p className="mt-2 text-sm text-amber-700">
            {t('info.resolveLiveConflict', 'Resolve live update conflicts before saving your changes.')}
          </p>
        ) : null}
      </div>
      <ConfirmationDialog
        id={`${id}-cancel-confirm-dialog`}
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={resetPendingChanges}
        title={t('info.discardChangesTitle', 'Discard Changes')}
        message={t('info.discardChangesMessage', 'Are you sure you want to discard your unsaved changes?')}
        confirmLabel={t('info.discardChanges', 'Discard Changes')}
        cancelLabel={t('actions.cancel', 'Cancel')}
      />
    </BentoTile>
  );
}

export default BentoHero;
