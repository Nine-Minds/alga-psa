'use client'


import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, MoreVertical, HelpCircle, ChevronDown, ArrowLeft, AlertTriangle, CheckCircle2, Settings2, Users, ListChecks, Mail, Zap, Clock, Search, Inbox, Star } from "lucide-react";
import { IBoard, ITeam, CategoryType, PriorityType, IPriority, IUser, DeletionValidationResult, DeletionDependency } from '@alga-psa/types';
import {
  getAllBoards,
  getBoardListStats,
  createBoard,
  updateBoard,
  deleteBoard,
  getBoardTicketStatuses,
  getBoardCloseRules,
  upsertBoardCloseRules,
  getBoardAutoCloseRules,
  createBoardAutoCloseRule,
  updateBoardAutoCloseRule,
  deleteBoardAutoCloseRule,
} from '@alga-psa/tickets/actions';
import type { IBoardAutoCloseRule, BoardListStats } from '@alga-psa/tickets/actions';
import { CLOSE_RULE_REQUIRED_FIELDS, CLOSE_RULE_REQUIRED_FIELD_LABELS } from '@alga-psa/tickets/lib';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from '@alga-psa/reference-data/actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getAllUsers, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getSlaPolicies } from '@alga-psa/sla/actions';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { ISlaPolicy } from '@alga-psa/sla/types';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Switch } from '@alga-psa/ui/components/Switch';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import Pagination from '@alga-psa/ui/components/Pagination';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

type TicketStatusSeedMode = 'copy_existing' | 'create_inline';
type ManagedTicketStatus = {
  status_id?: string;
  temp_id: string;
  name: string;
  is_closed: boolean;
  is_default: boolean;
  order_number: number;
  color?: string | null;
  icon?: string | null;
};

function createManagedTicketStatus(index: number): ManagedTicketStatus {
  return {
    temp_id: `inline-status-${Date.now()}-${index}`,
    name: index === 0 ? 'New' : '',
    is_closed: false,
    is_default: index === 0,
    order_number: (index + 1) * 10,
    color: null,
    icon: null,
  };
}

interface CloseRulesFormState {
  require_resolution_comment: boolean;
  require_time_entry: boolean;
  require_checklist_complete: boolean;
  require_no_open_children: boolean;
  required_fields: string[];
  is_enabled: boolean;
}

function createEmptyCloseRulesForm(): CloseRulesFormState {
  return {
    require_resolution_comment: false,
    require_time_entry: false,
    require_checklist_complete: false,
    require_no_open_children: false,
    required_fields: [],
    is_enabled: true,
  };
}

interface EditableAutoCloseRule {
  temp_id: string;
  rule_id?: string;
  trigger_status_id: string;
  inactivity_days: number;
  warning_days_before: number | null;
  close_to_status_id: string;
  is_enabled: boolean;
}

function createEmptyAutoCloseRule(index: number): EditableAutoCloseRule {
  return {
    temp_id: `auto-close-rule-${Date.now()}-${index}`,
    trigger_status_id: '',
    inactivity_days: 7,
    warning_days_before: null,
    close_to_status_id: '',
    is_enabled: true,
  };
}

function mapBoardStatusesToManagedStatuses(
  statuses: Array<{
    status_id?: string;
    name: string;
    is_closed: boolean;
    is_default?: boolean;
    order_number?: number;
    color?: string | null;
    icon?: string | null;
  }>
): ManagedTicketStatus[] {
  return statuses.map((status, index) => ({
    status_id: status.status_id,
    temp_id: status.status_id || `board-status-${Date.now()}-${index}`,
    name: status.name,
    is_closed: status.is_closed,
    is_default: Boolean(status.is_default),
    order_number: status.order_number || ((index + 1) * 10),
    color: status.color || null,
    icon: status.icon || null,
  }));
}

function normalizeManagedTicketStatuses(statuses: ManagedTicketStatus[]) {
  return statuses
    .map((status, index) => ({
      status_id: status.status_id,
      name: status.name.trim(),
      is_closed: status.is_closed,
      is_default: status.is_default,
      order_number: (index + 1) * 10,
      color: status.color || null,
      icon: status.icon || null,
    }))
    .filter((status) => status.name.length > 0);
}

type ManagedTicketStatusValidationCode =
  | 'STATUS_REQUIRED'
  | 'DUPLICATE_STATUS_NAME'
  | 'INVALID_OPEN_DEFAULT';

function getManagedTicketStatusValidationError(
  statuses: ManagedTicketStatus[]
): ManagedTicketStatusValidationCode | null {
  const normalizedStatuses = normalizeManagedTicketStatuses(statuses);

  if (normalizedStatuses.length === 0) {
    return 'STATUS_REQUIRED';
  }

  const duplicateName = normalizedStatuses.find((status, index) =>
    normalizedStatuses.findIndex((candidate) => candidate.name.toLowerCase() === status.name.toLowerCase()) !== index
  );
  if (duplicateName) {
    return 'DUPLICATE_STATUS_NAME';
  }

  const openDefaultStatuses = normalizedStatuses.filter((status) => status.is_default && !status.is_closed);
  if (openDefaultStatuses.length !== 1 || normalizedStatuses.some((status) => status.is_default && status.is_closed)) {
    return 'INVALID_OPEN_DEFAULT';
  }

  return null;
}

const TICKET_STATUS_VALIDATION_KEYS: Record<ManagedTicketStatusValidationCode, string> = {
  STATUS_REQUIRED: 'ticketing.boards.messages.error.statusRequired',
  DUPLICATE_STATUS_NAME: 'ticketing.boards.messages.error.duplicateStatusName',
  INVALID_OPEN_DEFAULT: 'ticketing.boards.messages.error.invalidOpenDefault'
};

interface EditorSectionProps {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  open: boolean;
  dirty: boolean;
  onToggle: () => void;
  onSave: () => void;
  saveLabel: string;
  unsavedLabel: string;
  saveDisabled?: boolean;
  error?: string;
  required?: boolean;
  requiredLabel?: string;
  children: React.ReactNode;
}

const EditorAccordionSection: React.FC<EditorSectionProps> = ({
  id, title, description, icon, open, dirty, onToggle, onSave, saveLabel, unsavedLabel, saveDisabled, error, required, requiredLabel, children,
}) => (
  <section className={`overflow-hidden rounded-lg border bg-white ${error ? 'border-red-300' : 'border-gray-200'}`}>
    <div className={`flex items-center gap-3 px-5 py-4 ${open ? 'border-b border-gray-100' : ''}`}>
      <button id={`board-editor-section-${id}`} type="button" onClick={onToggle} className="flex flex-1 items-center gap-3 text-left">
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} />
        {icon && <span className="text-primary-500">{icon}</span>}
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">
              {title}
              {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
            </h4>
            {required && (
              <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                {requiredLabel}
              </span>
            )}
            {dirty && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                <AlertTriangle className="h-3 w-3" />{unsavedLabel}
              </span>
            )}
          </div>
          {description && <p className="text-xs text-gray-500">{description}</p>}
        </div>
      </button>
      {dirty && (
        <Button id={`save-board-section-${id}`} size="sm" onClick={onSave} disabled={saveDisabled}>
          {saveLabel}
        </Button>
      )}
    </div>
    {open && (
      <div className="px-5 py-5">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription data-testid={`board-editor-section-error-${id}`}>{error}</AlertDescription>
          </Alert>
        )}
        {children}
      </div>
    )}
  </section>
);

/* ---- Boards list presentational helpers (tickets-style rich rows) ---- */
const BOARD_LIST_COLORS = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];
function boardColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BOARD_LIST_COLORS[h % BOARD_LIST_COLORS.length];
}
function boardInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
const BOARD_PILL_TONES = {
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
} as const;
const ListPill: React.FC<{ tone?: keyof typeof BOARD_PILL_TONES; children: React.ReactNode }> = ({ tone = 'gray', children }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${BOARD_PILL_TONES[tone]}`}>{children}</span>
);
const BoardListAvatar: React.FC<{ name: string; isTeam?: boolean }> = ({ name, isTeam = false }) => (
  <span
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[10px] font-semibold text-white"
    style={{ background: boardColor(name), borderRadius: isTeam ? 6 : 9999 }}
  >
    {boardInitials(name)}
  </span>
);
const BoardLoadBar: React.FC<{ open: number; total: number }> = ({ open, total }) => {
  const pct = total === 0 ? 0 : Math.round((open / total) * 100);
  return (
    <div className="min-w-[110px]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold text-gray-900">{open}</span>
        <span className="text-xs text-gray-400">/ {total}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// Editor accordion: rendered top-to-bottom in this order. Only the first
// section (General) is expanded when the editor opens; the rest start collapsed.
const EDITOR_SECTION_IDS = ['general', 'assignment', 'inbound', 'close', 'automation', 'statuses', 'display'] as const;
const collapsedExceptFirstSection = (): Set<string> => new Set<string>(EDITOR_SECTION_IDS.slice(1));
// When creating a board, also expand 'statuses' up front — ticket statuses are
// required and otherwise hidden inside a collapsed section.
const collapsedForCreate = (): Set<string> =>
  new Set<string>(EDITOR_SECTION_IDS.filter((id) => id !== 'general' && id !== 'statuses'));

// Boards list pagination — matches the shared DataTable default page size.
const BOARDS_PAGE_SIZE = 10;

interface BoardsSettingsProps {
  /** Hide SLA configuration in AlgaDesk edition. Passed by the host page from useProduct(). */
  isAlgaDesk?: boolean;
}

const BoardsSettings: React.FC<BoardsSettingsProps> = ({ isAlgaDesk = false }) => {
  const { t } = useTranslation('msp/settings');
  // Pagination option labels live in the shared 'common' namespace (same as DataTable).
  const { t: tCommon } = useTranslation('common');
  // Dark-release gate for the auto-close rules UI. Off by default (PostHog
  // returns false for an unknown flag); UI-only — the auto-close engine and
  // server actions stay live regardless.
  const { enabled: autoCloseRulesUiEnabled } = useFeatureFlag('ticket-auto-close-rules');
  const createEmptyFormData = () => ({
    board_name: '',
    description: '',
    display_order: 0,
    is_inactive: false,
    is_default: false,
    category_type: 'custom' as CategoryType,
    priority_type: 'custom' as PriorityType,
    is_itil_compliant: false,
    default_assigned_to: '',
    default_assigned_team_id: '',
    default_priority_id: '',
    manager_user_id: '',
    sla_policy_id: '',
    inbound_reply_reopen_enabled: false,
    inbound_reply_reopen_cutoff_hours: 168,
    inbound_reply_reopen_status_id: '',
    inbound_reply_ai_ack_suppression_enabled: false,
    enable_live_ticket_timer: true,
    status_seed_mode: 'copy_existing' as TicketStatusSeedMode,
    copy_ticket_statuses_from_board_id: '',
    ticket_statuses: [] as ManagedTicketStatus[],
  });
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<ISlaPolicy[]>([]);
  const [boardStats, setBoardStats] = useState<Record<string, BoardListStats>>({});
  const [listSearch, setListSearch] = useState('');
  const [boardsPage, setBoardsPage] = useState(1);
  const [boardsPageSize, setBoardsPageSize] = useState(BOARDS_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // Per-section validation errors shown inside the relevant accordion section,
  // so the message appears where the offending field is (not just a top banner).
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    boardId: string;
    boardName: string;
    confirmForce?: boolean;
    confirmCleanupItil?: boolean;
    message?: string;
    blockingError?: {
      code: string;
      message: string;
      counts?: Record<string, number>;
    };
  }>({
    isOpen: false,
    boardId: '',
    boardName: ''
  });

  const deleteValidation = useMemo<DeletionValidationResult | null>(() => {
    if (!deleteDialog.isOpen) {
      return null;
    }

    if (deleteDialog.blockingError) {
      const dependencies: DeletionDependency[] = deleteDialog.blockingError.counts
        ? Object.entries(deleteDialog.blockingError.counts).map(([key, count]) => ({
            type: key,
            count,
            label: count === 1 ? key.replace(/_/g, ' ') : `${key.replace(/_/g, ' ')}s`
          }))
        : [];

      return {
        canDelete: false,
        code: 'DEPENDENCIES_EXIST',
        message: deleteDialog.blockingError.message,
        dependencies,
        alternatives: []
      };
    }

    return {
      canDelete: true,
      dependencies: [],
      alternatives: []
    };
  }, [deleteDialog]);

  // State for Add/Edit Dialog
  const [showAddEditDialog, setShowAddEditDialog] = useState(false);
  const [editingBoard, setEditingBoard] = useState<IBoard | null>(null);
  const [formData, setFormData] = useState(createEmptyFormData);
  const [isLoadingBoardStatuses, setIsLoadingBoardStatuses] = useState(false);
  // Tracks the close-rules / auto-close fetch on edit so the dirty baseline is
  // captured only after those values land (otherwise both sections show as dirty on open).
  const [isLoadingCloseRules, setIsLoadingCloseRules] = useState(false);
  const [closeRulesForm, setCloseRulesForm] = useState<CloseRulesFormState>(createEmptyCloseRulesForm);
  const [autoCloseRulesForm, setAutoCloseRulesForm] = useState<EditableAutoCloseRule[]>([]);
  const [removedAutoCloseRuleIds, setRemovedAutoCloseRuleIds] = useState<string[]>([]);
  // Accordion editor: per-section collapse state + dirty tracking against an on-open baseline
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(collapsedExceptFirstSection);
  const [formSnapshot, setFormSnapshot] = useState<Record<string, string> | null>(null);
  
  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceBoards, setAvailableReferenceBoards] = useState<any[]>([]);

  // State for ITIL Info Modal
  const [showItilInfoModal, setShowItilInfoModal] = useState(false);
  const [selectedImportBoards, setSelectedImportBoards] = useState<string[]>([]);
  const [importBoardItilSettings, setImportBoardItilSettings] = useState<Record<string, boolean>>({});
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});

  useEffect(() => {
    fetchBoards();
    fetchUsers();
    fetchPriorities();
    fetchSlaPolicies();
    fetchTeams();
  }, []);

  const fetchBoardStats = async () => {
    try {
      setBoardStats(await getBoardListStats());
    } catch (statsError) {
      console.error('Error fetching board stats:', statsError);
    }
  };

  // Prevent saving a mismatched default priority when toggling ITIL compliance on new boards.
  useEffect(() => {
    if (editingBoard) return;
    if (!formData.default_priority_id) return;
    const match = priorities.find(p => p.priority_id === formData.default_priority_id);
    if (!match) {
      setFormData(prev => ({ ...prev, default_priority_id: '' }));
      return;
    }

    const effectivePriorityType: PriorityType = formData.is_itil_compliant ? 'itil' : 'custom';
    const isItil = !!match.is_from_itil_standard;
    if ((effectivePriorityType === 'itil' && !isItil) || (effectivePriorityType !== 'itil' && isItil)) {
      setFormData(prev => ({ ...prev, default_priority_id: '' }));
    }
  }, [editingBoard, formData.default_priority_id, formData.is_itil_compliant, priorities]);

  const fetchBoards = async () => {
    try {
      const allBoards = await getAllBoards(true);
      setBoards(allBoards);
      void fetchBoardStats();
    } catch (error) {
      console.error('Error fetching boards:', error);
      setError(t('ticketing.boards.messages.error.fetchFailed'));
    }
  };

  const fetchUsers = async () => {
    try {
      // Fetch only active internal users for the default assigned agent picker
      const allUsers = await getAllUsers(false, 'internal');
      setUsers(allUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchTeams = async () => {
    try {
      const allTeams = await getTeams();
      setTeams(allTeams);
    } catch (error) {
      console.error('Error fetching teams:', error);
    }
  };

  const fetchPriorities = async () => {
    try {
      const allPriorities = await getAllPriorities('ticket');
      setPriorities(allPriorities || []);
    } catch (error) {
      console.error('Error fetching priorities:', error);
      setPriorities([]);
    }
  };

  const fetchSlaPolicies = async () => {
    try {
      const policies = await getSlaPolicies();
      setSlaPolicies(policies);
    } catch (error) {
      console.error('Error fetching SLA policies:', error);
    }
  };

  const loadManagedTicketStatusesFromBoard = async (boardId: string) => {
    setIsLoadingBoardStatuses(true);

    try {
      const boardStatuses = await getBoardTicketStatuses(boardId);
      setFormData((prev) => ({
        ...prev,
        ticket_statuses: mapBoardStatusesToManagedStatuses(boardStatuses),
      }));
    } catch (loadError) {
      console.error('Error loading board ticket statuses:', loadError);
      setDialogError(loadError instanceof Error ? loadError.message : t('ticketing.boards.messages.error.fetchStatusesFailed'));
    } finally {
      setIsLoadingBoardStatuses(false);
    }
  };

  // Loads a board's persisted editor data (ticket statuses + close/auto-close rules)
  // and toggles the loading flags. Used on edit-open and again after an in-place save,
  // so the dirty baseline reflects what is actually stored (and re-saving doesn't
  // duplicate auto-close rules or re-delete already-removed ones).
  const reloadBoardEditorData = async (board: IBoard) => {
    setIsLoadingBoardStatuses(true);
    setIsLoadingCloseRules(true);
    setRemovedAutoCloseRuleIds([]);

    await loadManagedTicketStatusesFromBoard(board.board_id!);

    try {
      const [closeRules, autoRules] = await Promise.all([
        getBoardCloseRules(board.board_id!),
        getBoardAutoCloseRules(board.board_id!),
      ]);
      setCloseRulesForm({
        require_resolution_comment: closeRules.require_resolution_comment,
        require_time_entry: closeRules.require_time_entry,
        require_checklist_complete: closeRules.require_checklist_complete,
        require_no_open_children: closeRules.require_no_open_children,
        required_fields: closeRules.required_fields,
        is_enabled: closeRules.is_enabled,
      });
      setAutoCloseRulesForm(
        autoRules.map((rule: IBoardAutoCloseRule) => ({
          temp_id: rule.rule_id,
          rule_id: rule.rule_id,
          trigger_status_id: rule.trigger_status_id,
          inactivity_days: rule.inactivity_days,
          warning_days_before: rule.warning_days_before,
          close_to_status_id: rule.close_to_status_id,
          is_enabled: rule.is_enabled,
        }))
      );
    } catch (loadError) {
      console.error('Error loading board close rules:', loadError);
      setDialogError(loadError instanceof Error ? loadError.message : t('ticketing.boards.closeRules.messages.fetchFailed'));
    } finally {
      setIsLoadingCloseRules(false);
    }
  };

  const startEditing = async (board: IBoard) => {
    setEditingBoard(board);
    setFormData({
      ...createEmptyFormData(),
      board_name: board.board_name || '',
      description: board.description || '',
      display_order: board.display_order || 0,
      is_inactive: board.is_inactive,
      is_default: board.is_default ?? false,
      category_type: board.category_type || 'custom',
      priority_type: board.priority_type || 'custom',
      is_itil_compliant: board.category_type === 'itil' && board.priority_type === 'itil',
      default_assigned_to: board.default_assigned_to || '',
      default_assigned_team_id: board.default_assigned_team_id || '',
      default_priority_id: board.default_priority_id || '',
      manager_user_id: board.manager_user_id || '',
      sla_policy_id: board.sla_policy_id || '',
      inbound_reply_reopen_enabled: board.inbound_reply_reopen_enabled ?? false,
      inbound_reply_reopen_cutoff_hours: board.inbound_reply_reopen_cutoff_hours ?? 168,
      inbound_reply_reopen_status_id: board.inbound_reply_reopen_status_id || '',
      inbound_reply_ai_ack_suppression_enabled: board.inbound_reply_ai_ack_suppression_enabled ?? false,
      enable_live_ticket_timer: board.enable_live_ticket_timer ?? true,
      ticket_statuses: [],
    });
    setShowAddEditDialog(true);
    setError(null);
    setDialogError(null);
    setCollapsedSections(collapsedExceptFirstSection());
    setCloseRulesForm(createEmptyCloseRulesForm());
    setAutoCloseRulesForm([]);

    await reloadBoardEditorData(board);
  };

  const updateManagedTicketStatus = (tempId: string, updates: Partial<ManagedTicketStatus>) => {
    setFormData((prev) => ({
      ...prev,
      ticket_statuses: prev.ticket_statuses.map((status) =>
        status.temp_id === tempId ? { ...status, ...updates } : status
      ),
    }));
  };

  const setManagedDefaultStatus = (tempId: string) => {
    setFormData((prev) => ({
      ...prev,
      ticket_statuses: prev.ticket_statuses.map((status) => ({
        ...status,
        is_default: status.temp_id === tempId,
      })),
    }));
  };

  const addManagedTicketStatus = () => {
    setFormData((prev) => ({
      ...prev,
      ticket_statuses: [
        ...prev.ticket_statuses,
        createManagedTicketStatus(prev.ticket_statuses.length),
      ],
    }));
  };

  const removeManagedTicketStatus = (tempId: string) => {
    setFormData((prev) => {
      const remainingStatuses = prev.ticket_statuses.filter((status) => status.temp_id !== tempId);
      if (remainingStatuses.length > 0 && !remainingStatuses.some((status) => status.is_default)) {
        remainingStatuses[0] = { ...remainingStatuses[0], is_default: true };
      }

      return {
        ...prev,
        ticket_statuses: remainingStatuses.map((status, index) => ({
          ...status,
          order_number: (index + 1) * 10,
        })),
      };
    });
  };

  const moveManagedTicketStatus = (tempId: string, direction: 'up' | 'down') => {
    setFormData((prev) => {
      const currentIndex = prev.ticket_statuses.findIndex((status) => status.temp_id === tempId);
      if (currentIndex === -1) {
        return prev;
      }

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= prev.ticket_statuses.length) {
        return prev;
      }

      const nextStatuses = [...prev.ticket_statuses];
      const [movedStatus] = nextStatuses.splice(currentIndex, 1);
      nextStatuses.splice(targetIndex, 0, movedStatus);

      return {
        ...prev,
        ticket_statuses: nextStatuses.map((status, index) => ({
          ...status,
          order_number: (index + 1) * 10,
        })),
      };
    });
  };

  const handleDeleteBoard = async (force = false, cleanupItil = false) => {
    try {
      const result = await deleteBoard(deleteDialog.boardId, force, cleanupItil);

      if (result.success) {
        toast.success(result.message || t('ticketing.boards.messages.success.deleted'));
        setDeleteDialog({ isOpen: false, boardId: '', boardName: '' });
        await fetchBoards();
        return;
      }

      // Handle different error codes
      switch (result.code) {
        case 'BOARD_HAS_CATEGORIES':
        case 'BOARD_HAS_STATUSES':
          // Show confirmation dialog to force delete categories/statuses
          setDeleteDialog({
            ...deleteDialog,
            confirmForce: true,
            confirmCleanupItil: false,
            message: result.message,
            blockingError: undefined
          });
          break;
        case 'LAST_ITIL_BOARD':
          // Show confirmation dialog for ITIL cleanup
          setDeleteDialog({
            ...deleteDialog,
            confirmForce: deleteDialog.confirmForce || false,
            confirmCleanupItil: true,
            message: result.message,
            blockingError: undefined
          });
          break;
        case 'BOARD_HAS_TICKETS':
        case 'BOARD_IS_DEFAULT':
        case 'BOARD_USED_IN_EMAIL_ROUTING':
          // Blocking errors - show in dialog, not toast
          setDeleteDialog({
            ...deleteDialog,
            blockingError: {
              code: result.code || 'UNKNOWN',
              message: result.message || 'Cannot delete board',
              counts: result.counts
            }
          });
          break;
        case 'NOT_FOUND':
        case 'NO_TENANT':
        default:
          // Fatal errors - show toast and close dialog
          toast.error(result.message || t('ticketing.boards.messages.error.deleteFailed'));
          setDeleteDialog({ isOpen: false, boardId: '', boardName: '' });
          break;
      }
    } catch (error) {
      handleError(error, t('ticketing.boards.messages.error.deleteFailed'));
      setDeleteDialog({ isOpen: false, boardId: '', boardName: '' });
    }
  };

  const shouldManageTicketStatuses =
    Boolean(editingBoard) ||
    formData.status_seed_mode === 'create_inline' ||
    (formData.status_seed_mode === 'copy_existing' && Boolean(formData.copy_ticket_statuses_from_board_id));
  const ticketStatusValidationError = useMemo(() => (
    shouldManageTicketStatuses ? getManagedTicketStatusValidationError(formData.ticket_statuses) : null
  ), [formData.ticket_statuses, shouldManageTicketStatuses]);

  const trimmedBoardName = formData.board_name.trim();
  const isDuplicateBoardName = useMemo(() => {
    if (!trimmedBoardName) return false;
    const target = trimmedBoardName.toLowerCase();
    return boards.some((board) =>
      board.board_id !== editingBoard?.board_id &&
      (board.board_name || '').trim().toLowerCase() === target
    );
  }, [boards, editingBoard, trimmedBoardName]);

  // Surface a validation failure inside its accordion section: record the message,
  // make sure the section is expanded, and scroll it into view. Pass no message to
  // just expand + scroll to a section whose field already renders its own inline error.
  const failInSection = (sectionId: string, message?: string) => {
    setSectionErrors(message ? { [sectionId]: message } : {});
    setCollapsedSections((prev) => {
      if (!prev.has(sectionId)) return prev;
      const next = new Set(prev);
      next.delete(sectionId);
      return next;
    });
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        const el = document.getElementById(`board-editor-section-${sectionId}`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 0);
    }
  };

  const handleSaveBoard = async () => {
    try {
      setDialogError(null);
      setSectionErrors({});

      if (!formData.board_name.trim()) {
        failInSection('general', t('ticketing.boards.messages.error.nameRequired'));
        return;
      }

      if (isDuplicateBoardName) {
        // The board-name field already renders an inline duplicate error; just reveal it.
        failInSection('general');
        return;
      }

      // For new boards, set category_type and priority_type based on ITIL compliance
      const categoryType = editingBoard ? formData.category_type : (formData.is_itil_compliant ? 'itil' : 'custom');
      const priorityType = editingBoard ? formData.priority_type : (formData.is_itil_compliant ? 'itil' : 'custom');
      const isCreatingBoard = !editingBoard;
      const shouldPersistManagedStatuses = isCreatingBoard && shouldManageTicketStatuses;
      const normalizedTicketStatuses = normalizeManagedTicketStatuses(formData.ticket_statuses);
      const shouldRequireStatusCopySource =
        isCreatingBoard &&
        formData.status_seed_mode === 'copy_existing';

      if (shouldRequireStatusCopySource && !formData.copy_ticket_statuses_from_board_id) {
        failInSection('statuses', t('ticketing.boards.messages.error.selectBoardToCopy'));
        return;
      }

      if (shouldManageTicketStatuses && ticketStatusValidationError) {
        // The statuses section already renders an inline validation error; just reveal it.
        failInSection('statuses');
        return;
      }

      if (editingBoard && autoCloseRulesUiEnabled) {
        for (const rule of autoCloseRulesForm) {
          if (!rule.trigger_status_id || !rule.close_to_status_id) {
            failInSection('automation', t('ticketing.boards.closeRules.messages.autoCloseStatusRequired'));
            return;
          }
          if (!Number.isInteger(rule.inactivity_days) || rule.inactivity_days < 1) {
            failInSection('automation', t('ticketing.boards.closeRules.messages.autoCloseDaysInvalid'));
            return;
          }
          if (
            rule.warning_days_before !== null &&
            (!Number.isInteger(rule.warning_days_before) ||
              rule.warning_days_before < 1 ||
              rule.warning_days_before >= rule.inactivity_days)
          ) {
            failInSection('automation', t('ticketing.boards.closeRules.messages.autoCloseWarningInvalid'));
            return;
          }
        }
      }

      if (editingBoard) {
        await updateBoard(editingBoard.board_id!, {
          board_name: formData.board_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          is_default: formData.is_default,
          category_type: categoryType,
          priority_type: priorityType,
          default_assigned_to: formData.default_assigned_to || null,
          default_assigned_team_id: formData.default_assigned_team_id || null,
          default_priority_id: formData.default_priority_id || null,
          manager_user_id: formData.manager_user_id || null,
          sla_policy_id: formData.sla_policy_id || null,
          inbound_reply_reopen_enabled: formData.inbound_reply_reopen_enabled,
          inbound_reply_reopen_cutoff_hours: Math.max(1, Number(formData.inbound_reply_reopen_cutoff_hours) || 168),
          inbound_reply_reopen_status_id: formData.inbound_reply_reopen_status_id || null,
          inbound_reply_ai_ack_suppression_enabled: formData.inbound_reply_ai_ack_suppression_enabled,
          enable_live_ticket_timer: formData.enable_live_ticket_timer,
          ticket_statuses: normalizedTicketStatuses,
        });

        await upsertBoardCloseRules(editingBoard.board_id!, closeRulesForm);

        if (autoCloseRulesUiEnabled) {
          for (const ruleId of removedAutoCloseRuleIds) {
            await deleteBoardAutoCloseRule(ruleId);
          }
          for (const rule of autoCloseRulesForm) {
            const payload = {
              trigger_status_id: rule.trigger_status_id,
              inactivity_days: rule.inactivity_days,
              warning_days_before: rule.warning_days_before,
              close_to_status_id: rule.close_to_status_id,
              is_enabled: rule.is_enabled,
            };
            if (rule.rule_id) {
              await updateBoardAutoCloseRule(rule.rule_id, payload);
            } else {
              await createBoardAutoCloseRule(editingBoard.board_id!, payload);
            }
          }
        }

        toast.success(t('ticketing.boards.messages.success.updated'));

        // Stay in the editor after saving. Reflect the saved name in the header,
        // refresh the list/stats, then re-baseline the dirty state from what was
        // actually persisted so the unsaved indicators clear without navigating away.
        setEditingBoard((prev) => (prev ? { ...prev, board_name: formData.board_name, description: formData.description } : prev));
        await fetchBoards();
        setFormSnapshot(null);
        await reloadBoardEditorData(editingBoard);
        return;
      } else {
        await createBoard({
          board_name: formData.board_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          is_default: formData.is_default,
          category_type: categoryType,
          priority_type: priorityType,
          default_assigned_to: formData.default_assigned_to || null,
          default_assigned_team_id: formData.default_assigned_team_id || null,
          default_priority_id: formData.default_priority_id || null,
          manager_user_id: formData.manager_user_id || null,
          sla_policy_id: formData.sla_policy_id || null,
          inbound_reply_reopen_enabled: formData.inbound_reply_reopen_enabled,
          inbound_reply_reopen_cutoff_hours: Math.max(1, Number(formData.inbound_reply_reopen_cutoff_hours) || 168),
          // The copied/inline statuses are (re)created server-side with fresh ids, so any
          // status id chosen here would dangle to another board. Reopen falls back to the
          // default open status; the specific status can be set after the board exists.
          inbound_reply_reopen_status_id: null,
          inbound_reply_ai_ack_suppression_enabled: formData.inbound_reply_ai_ack_suppression_enabled,
          enable_live_ticket_timer: formData.enable_live_ticket_timer,
          copy_ticket_statuses_from_board_id: formData.status_seed_mode === 'copy_existing'
            ? (formData.copy_ticket_statuses_from_board_id || null)
            : null,
          ticket_statuses: shouldPersistManagedStatuses ? normalizedTicketStatuses : undefined,
        });
        toast.success(t('ticketing.boards.messages.success.created'));
      }

      setShowAddEditDialog(false);
      setEditingBoard(null);
      setFormData(createEmptyFormData());
      await fetchBoards();
    } catch (error) {
      console.error('Error saving board:', error);
      setDialogError(error instanceof Error ? error.message : t('ticketing.boards.messages.error.saveFailed'));
    }
  };

  const handleImport = async () => {
    try {
      // Get the reference boards data first
      const referenceBoards = availableReferenceBoards.filter(board =>
        selectedImportBoards.includes(board.id)
      );

      // Separate ITIL and non-ITIL boards
      const itilBoards = referenceBoards.filter(board =>
        importBoardItilSettings[board.id]
      );
      const regularBoards = referenceBoards.filter(board =>
        !importBoardItilSettings[board.id]
      );

      const allResults: any = { imported: [], skipped: [] };

      // Import regular boards using the existing process
      if (regularBoards.length > 0) {
        const regularBoardIds = regularBoards.map(c => c.id);
        let regularResult;

        if (importConflicts.length > 0) {
          const regularConflicts = Object.fromEntries(
            Object.entries(conflictResolutions).filter(([id]) => regularBoardIds.includes(id))
          );
          regularResult = await importReferenceData('boards', regularBoardIds, undefined, regularConflicts);
        } else {
          const conflicts = await checkImportConflicts('boards', regularBoardIds);
          if (conflicts.length > 0) {
            setImportConflicts(conflicts);
            return;
          }
          regularResult = await importReferenceData('boards', regularBoardIds);
        }

        if (regularResult?.imported) allResults.imported.push(...regularResult.imported);
        if (regularResult?.skipped) allResults.skipped.push(...regularResult.skipped);
      }

      // Create ITIL boards manually using the createBoard API
      for (const board of itilBoards) {
        try {
          const resolution = conflictResolutions[board.id];
          const boardName = resolution?.newName || board.board_name;
          const displayOrder = resolution?.newOrder || board.display_order;

          await createBoard({
            board_name: boardName,
            description: board.description || '',
            display_order: displayOrder,
            is_inactive: board.is_inactive || false,
            category_type: 'itil',
            priority_type: 'itil',
            enable_live_ticket_timer: true,
          });

          allResults.imported.push({
            board_name: boardName,
            reference_id: board.id
          });
        } catch (createError) {
          console.error(`Failed to create ITIL board ${board.board_name}:`, createError);
          allResults.skipped.push({
            name: board.board_name,
            reason: 'Failed to create as ITIL board'
          });
        }
      }

      toast.success(t('ticketing.boards.messages.success.imported'));
      setShowImportDialog(false);
      setSelectedImportBoards([]);
      setImportBoardItilSettings({});
      setImportConflicts([]);
      setConflictResolutions({});
      await fetchBoards();
    } catch (error) {
      handleError(error, t('ticketing.boards.messages.error.importFailed'));
    }
  };

  const closeEditor = () => {
    setShowAddEditDialog(false);
    setEditingBoard(null);
    setFormData(createEmptyFormData());
    setDialogError(null);
    setSectionErrors({});
    setIsLoadingBoardStatuses(false);
    setIsLoadingCloseRules(false);
    setCollapsedSections(collapsedExceptFirstSection());
    setFormSnapshot(null);
  };

  // Per-section serialization used to detect unsaved changes against the on-open baseline.
  const serializeSections = (): Record<string, string> => ({
    general: JSON.stringify({
      board_name: formData.board_name,
      description: formData.description,
      display_order: formData.display_order,
      is_inactive: formData.is_inactive,
      is_default: formData.is_default,
    }),
    assignment: JSON.stringify({
      default_assigned_to: formData.default_assigned_to,
      default_assigned_team_id: formData.default_assigned_team_id,
      sla_policy_id: formData.sla_policy_id,
      manager_user_id: formData.manager_user_id,
    }),
    statuses: JSON.stringify({
      default_priority_id: formData.default_priority_id,
      status_seed_mode: formData.status_seed_mode,
      copy_ticket_statuses_from_board_id: formData.copy_ticket_statuses_from_board_id,
      ticket_statuses: formData.ticket_statuses,
    }),
    close: JSON.stringify(closeRulesForm),
    automation: JSON.stringify({ rules: autoCloseRulesForm, removed: removedAutoCloseRuleIds }),
    inbound: JSON.stringify({
      enabled: formData.inbound_reply_reopen_enabled,
      cutoff: formData.inbound_reply_reopen_cutoff_hours,
      status: formData.inbound_reply_reopen_status_id,
      suppress: formData.inbound_reply_ai_ack_suppression_enabled,
    }),
    display: JSON.stringify({
      enable_live_ticket_timer: formData.enable_live_ticket_timer,
      is_itil_compliant: formData.is_itil_compliant,
    }),
  });

  // Capture the baseline once, after the editor opens and any async status load settles.
  useEffect(() => {
    if (!showAddEditDialog) {
      if (formSnapshot) setFormSnapshot(null);
      return;
    }
    if (isLoadingBoardStatuses || isLoadingCloseRules || formSnapshot) return;
    setFormSnapshot(serializeSections());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddEditDialog, isLoadingBoardStatuses, isLoadingCloseRules]);

  const currentSections = serializeSections();
  const isSectionDirty = (id: string) => !!formSnapshot && formSnapshot[id] !== currentSections[id];
  const dirtyCount = formSnapshot
    ? Object.keys(currentSections).filter((id) => formSnapshot[id] !== currentSections[id]).length
    : 0;
  const anyDirty = dirtyCount > 0;
  const toggleSection = (id: string) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const saveDisabled =
    isLoadingBoardStatuses ||
    !trimmedBoardName ||
    isDuplicateBoardName ||
    (shouldManageTicketStatuses && Boolean(ticketStatusValidationError)) ||
    (!editingBoard &&
      formData.status_seed_mode === 'copy_existing' &&
      !formData.copy_ticket_statuses_from_board_id);

  const visibleBoards = boards.filter((b) => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return true;
    return (b.board_name || '').toLowerCase().includes(q) || (b.description || '').toLowerCase().includes(q);
  });

  const boardsTotalPages = Math.max(1, Math.ceil(visibleBoards.length / boardsPageSize));
  const safeBoardsPage = Math.min(boardsPage, boardsTotalPages);
  const pagedBoards = visibleBoards.slice((safeBoardsPage - 1) * boardsPageSize, safeBoardsPage * boardsPageSize);
  const boardsPageSizeOptions = [10, 25, 50, 100].map((n) => ({
    value: String(n),
    label: tCommon('pagination.itemsPerPageOption', { count: n, defaultValue: `${n} per page` }),
  }));

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      {!showAddEditDialog && (
      <div>
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">{t('ticketing.boards.title')}</h3>
            <p className="text-sm text-gray-500">{t('ticketing.boards.alert')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              id="add-board-button"
              onClick={() => {
                setEditingBoard(null);
                setDialogError(null);
                setFormData(() => {
                  const nextFormData = createEmptyFormData();
                  if (boards.length === 0) {
                    return {
                      ...nextFormData,
                      status_seed_mode: 'create_inline' as TicketStatusSeedMode,
                      ticket_statuses: [createManagedTicketStatus(0)],
                    };
                  }
                  return nextFormData;
                });
                setCollapsedSections(collapsedForCreate());
                setShowAddEditDialog(true);
                setIsLoadingBoardStatuses(false);
                setIsLoadingCloseRules(false);
              }}
            >
              <Plus className="h-4 w-4 mr-2" /> {t('ticketing.boards.actions.addBoard')}
            </Button>
            <Button
              id="import-boards-button"
              variant="outline"
              onClick={async () => {
                try {
                  const available = await getAvailableReferenceData('boards');
                  setAvailableReferenceBoards(available || []);
                  setSelectedImportBoards([]);
                  setShowImportDialog(true);
                } catch (importError) {
                  handleError(importError, t('ticketing.boards.messages.error.fetchAvailableFailed'));
                }
              }}
            >
              {t('ticketing.boards.actions.importStandard')}
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Toolbar: search + active/inactive counts */}
        <div className="mb-3 flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              id="boards-search"
              value={listSearch}
              onChange={(e) => { setListSearch(e.target.value); setBoardsPage(1); }}
              placeholder={t('ticketing.boards.searchPlaceholder', 'Search boards…')}
              className="pl-9"
            />
          </div>
          <ListPill tone="indigo">{boards.filter((b) => !b.is_inactive).length} {t('ticketing.boards.statusLabels.active')}</ListPill>
          <ListPill tone="gray">{boards.filter((b) => b.is_inactive).length} {t('ticketing.boards.statusLabels.inactive')}</ListPill>
        </div>

        {/* Rich board table */}
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">{t('ticketing.boards.table.name')}</th>
                <th className="px-4 py-2.5">{t('ticketing.boards.table.defaultAgent')}</th>
                <th className="px-4 py-2.5">{t('ticketing.boards.fields.slaPolicy.label', 'SLA')}</th>
                <th className="px-4 py-2.5">{t('ticketing.boards.table.statuses', 'Statuses')}</th>
                <th className="px-4 py-2.5">{t('ticketing.boards.table.ticketLoad', 'Ticket load')}</th>
                <th className="px-4 py-2.5">{t('ticketing.boards.editor.sections.automation', 'Automation')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagedBoards.map((board) => {
                const stats = boardStats[board.board_id || ''];
                const team = board.default_assigned_team_id ? teams.find((tm) => tm.team_id === board.default_assigned_team_id) : null;
                const agent = board.default_assigned_to ? users.find((u) => u.user_id === board.default_assigned_to) : null;
                const assigneeName = team ? team.team_name : agent ? `${agent.first_name} ${agent.last_name}` : null;
                const sla = board.sla_policy_id ? slaPolicies.find((s) => s.sla_policy_id === board.sla_policy_id) : null;
                const isItil = board.category_type === 'itil' && board.priority_type === 'itil';
                const hasAutomation = stats?.closeRulesEnabled || (stats?.autoCloseRuleCount ?? 0) > 0 || board.inbound_reply_reopen_enabled;
                return (
                  <tr
                    key={board.board_id}
                    id={`board-row-${board.board_id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => startEditing(board)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        startEditing(board);
                      }
                    }}
                    className={`group cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${board.is_inactive ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                          <Inbox className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-gray-900 group-hover:text-primary-700">{board.board_name}</span>
                            {board.is_default && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                            {isItil && <ListPill tone="violet">ITIL</ListPill>}
                            {board.is_inactive && <ListPill tone="gray">{t('ticketing.boards.statusLabels.inactive')}</ListPill>}
                          </div>
                          {board.description && <p className="truncate text-xs text-gray-500 max-w-[260px]">{board.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {assigneeName ? (
                        <div className="flex items-center gap-2">
                          <BoardListAvatar name={assigneeName} isTeam={!!team} />
                          <span className="text-gray-700">{assigneeName}</span>
                        </div>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {sla ? <ListPill tone="green">{sla.policy_name}</ListPill> : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-gray-700"><ListChecks className="h-3.5 w-3.5 text-gray-400" />{stats?.statusCount ?? 0}</span>
                    </td>
                    <td className="px-4 py-3"><BoardLoadBar open={stats?.openTicketCount ?? 0} total={stats?.ticketCount ?? 0} /></td>
                    <td className="px-4 py-3">
                      {hasAutomation ? (
                        <div className="flex flex-wrap gap-1">
                          {stats?.closeRulesEnabled && <ListPill tone="blue"><ListChecks className="h-3 w-3" />{t('ticketing.boards.editor.sections.close', 'Close rules')}</ListPill>}
                          {(stats?.autoCloseRuleCount ?? 0) > 0 && <ListPill tone="violet"><Zap className="h-3 w-3" />{stats?.autoCloseRuleCount}</ListPill>}
                          {board.inbound_reply_reopen_enabled && <ListPill tone="amber"><Mail className="h-3 w-3" />{t('ticketing.boards.editor.reopenBadge', 'reopen')}</ListPill>}
                        </div>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button id={`board-actions-menu-${board.board_id}`} variant="ghost" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => startEditing(board)}>
                            {t('ticketing.boards.actions.edit')}
                          </DropdownMenuItem>
                          {!board.is_default && (
                            <DropdownMenuItem
                              onClick={() => setDeleteDialog({ isOpen: true, boardId: board.board_id || '', boardName: board.board_name || '' })}
                              className="text-destructive"
                            >
                              {t('ticketing.boards.actions.delete')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {visibleBoards.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">{t('ticketing.boards.empty', 'No boards found.')}</td></tr>
              )}
            </tbody>
          </table>
          {visibleBoards.length > 0 && (
            <div className="border-t border-gray-200">
              <Pagination
                id="boards-list-pagination"
                variant="clients"
                currentPage={safeBoardsPage}
                totalItems={visibleBoards.length}
                itemsPerPage={boardsPageSize}
                onPageChange={setBoardsPage}
                onItemsPerPageChange={(size) => { setBoardsPageSize(size); setBoardsPage(1); }}
                itemsPerPageOptions={boardsPageSizeOptions}
              />
            </div>
          )}
        </div>
      </div>
      )}

      <DeleteEntityDialog
        id="delete-board-dialog"
        isOpen={deleteDialog.isOpen && !deleteDialog.confirmForce && !deleteDialog.confirmCleanupItil}
        onClose={() => setDeleteDialog({ isOpen: false, boardId: '', boardName: '' })}
        onConfirmDelete={() => handleDeleteBoard(false, false)}
        entityName={deleteDialog.boardName || 'board'}
        validationResult={deleteValidation}
        isValidating={false}
        isDeleting={false}
      />

      <ConfirmationDialog
        isOpen={deleteDialog.isOpen && !!(deleteDialog.confirmForce || deleteDialog.confirmCleanupItil)}
        onClose={() => setDeleteDialog({ isOpen: false, boardId: '', boardName: '' })}
        onConfirm={() => {
          if (deleteDialog.confirmCleanupItil) {
            // User confirmed ITIL cleanup
            handleDeleteBoard(deleteDialog.confirmForce || false, true);
          } else {
            handleDeleteBoard(deleteDialog.confirmForce || false, false);
          }
        }}
        title={
          deleteDialog.confirmCleanupItil
            ? t('ticketing.boards.dialog.cleanupItilTitle')
            : t('ticketing.boards.dialog.deleteBoardTitle')
        }
        message={
          deleteDialog.confirmCleanupItil
            ? `${deleteDialog.message}\n\n${t('ticketing.boards.dialog.cleanupItilMessage')}`
            : `${deleteDialog.message} ${t('ticketing.boards.dialog.deleteBoardMessage')}`
        }
        confirmLabel={
          deleteDialog.confirmCleanupItil
            ? t('ticketing.boards.dialog.deleteAndCleanup')
            : t('ticketing.boards.dialog.deleteAll')
        }
        thirdButtonLabel={deleteDialog.confirmCleanupItil && !deleteDialog.blockingError ? t('ticketing.boards.dialog.deleteOnly') : undefined}
        onCancel={deleteDialog.confirmCleanupItil && !deleteDialog.blockingError ? () => {
          // Skip ITIL cleanup but still delete the board
          handleDeleteBoard(deleteDialog.confirmForce || false, false);
        } : undefined}
      />

      {/* Dedicated board editor (in-view; replaces the boards list while open) */}
      {showAddEditDialog && (
      <div>
        <div className="mb-4 flex items-center gap-3">
          <Button id="board-editor-back" variant="soft" size="sm" onClick={closeEditor}>
            <ArrowLeft className="h-4 w-4 mr-2" />{t('ticketing.boards.actions.back', 'Back to Boards')}
          </Button>
          <h3 className="text-lg font-semibold text-gray-800">
            {editingBoard ? editingBoard.board_name : t('ticketing.boards.dialog.addBoard')}
          </h3>
          {dirtyCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {dirtyCount} {t('ticketing.boards.editor.unsaved', 'Unsaved')}
            </span>
          )}
        </div>

        {dialogError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{dialogError}</AlertDescription>
          </Alert>
        )}
        {anyDirty && (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              {t('ticketing.boards.editor.unsavedBanner', 'You have unsaved changes. Click "Save Changes" to apply them.')}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3 pb-24">
          <EditorAccordionSection
            id="general"
            error={sectionErrors['general']}
            title={t('ticketing.boards.editor.sections.general', 'General')}
            description={t('ticketing.boards.editor.sections.generalHelp', 'Name, description, visibility and default')}
            icon={<Settings2 className="h-4 w-4" />}
            open={!collapsedSections.has('general')}
            dirty={isSectionDirty('general')}
            onToggle={() => toggleSection('general')}
            onSave={handleSaveBoard}
            saveLabel={t('ticketing.boards.editor.saveChanges', 'Save Changes')}
            unsavedLabel={t('ticketing.boards.editor.unsaved', 'Unsaved')}
            saveDisabled={saveDisabled}
          >
          <div className="space-y-4">
            <div>
              <Label htmlFor="board_name" required>{t('ticketing.boards.fields.boardName.label')}</Label>
              <Input
                id="board_name"
                value={formData.board_name}
                onChange={(e) => setFormData({ ...formData, board_name: e.target.value })}
                placeholder={t('ticketing.boards.fields.boardName.placeholder')}
              />
              {isDuplicateBoardName && (
                <p className="text-sm text-red-600 mt-1" data-testid="board-name-duplicate-error">
                  {t('ticketing.boards.messages.error.nameAlreadyExists')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="description">{t('ticketing.boards.fields.description.label')}</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('ticketing.boards.fields.description.placeholder')}
              />
            </div>
            <div>
              <Label htmlFor="display_order">{t('ticketing.boards.fields.displayOrder.label')}</Label>
              <Input
                id="display_order"
                type="number"
                value={formData.display_order}
                onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                placeholder={t('ticketing.boards.fields.displayOrder.placeholder')}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('ticketing.boards.fields.displayOrder.help')}
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="is_inactive">{t('ticketing.boards.fields.inactive')}</Label>
              <Switch
                id="is_inactive"
                checked={formData.is_inactive}
                onCheckedChange={(checked) => setFormData({ ...formData, is_inactive: checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-gray-200 bg-gray-50/60 p-3">
              <div>
                <Label htmlFor="is_default">{t('ticketing.boards.fields.defaultBoard.label', 'Default board for client portal tickets')}</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('ticketing.boards.fields.defaultBoard.help', 'New tickets submitted from the client portal land on this board. Only one board can be the default.')}
                </p>
              </div>
              <Switch
                id="is_default"
                checked={formData.is_default}
                onCheckedChange={(checked) => setFormData({ ...formData, is_default: checked })}
              />
            </div>
          </div>
          </EditorAccordionSection>

          <EditorAccordionSection
            id="assignment"
            error={sectionErrors['assignment']}
            title={t('ticketing.boards.editor.sections.assignment', 'Assignment & SLA')}
            description={t('ticketing.boards.editor.sections.assignmentHelp', 'Default routing, SLA and board manager')}
            icon={<Users className="h-4 w-4" />}
            open={!collapsedSections.has('assignment')}
            dirty={isSectionDirty('assignment')}
            onToggle={() => toggleSection('assignment')}
            onSave={handleSaveBoard}
            saveLabel={t('ticketing.boards.editor.saveChanges', 'Save Changes')}
            unsavedLabel={t('ticketing.boards.editor.unsaved', 'Unsaved')}
            saveDisabled={saveDisabled}
          >
          <div className="space-y-4">
            <div>
              <Label htmlFor="default-assigned-agent-picker">{t('ticketing.boards.fields.defaultAssignedAgent.label')}</Label>
              <UserAndTeamPicker
                id="default-assigned-agent-picker"
                value={formData.default_assigned_to}
                onValueChange={(value) => setFormData({ ...formData, default_assigned_to: value, default_assigned_team_id: '' })}
                onTeamSelect={(teamId) => {
                  const team = teams.find(t => t.team_id === teamId);
                  setFormData({
                    ...formData,
                    default_assigned_team_id: teamId,
                    default_assigned_to: team?.manager_id || ''
                  });
                }}
                users={users}
                teams={teams}
                getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                placeholder={t('ticketing.boards.fields.defaultAssignedAgent.placeholder')}
                buttonWidth="full"
                labelStyle="none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('ticketing.boards.fields.defaultAssignedAgent.help')}
              </p>
            </div>
            {!isAlgaDesk && (
              <div>
                <Label htmlFor="sla-policy-picker">{t('ticketing.boards.fields.slaPolicy.label')}</Label>
                <CustomSelect
                  id="sla-policy-picker"
                  value={formData.sla_policy_id}
                  onValueChange={(value) => setFormData({ ...formData, sla_policy_id: value })}
                  options={[
                    { value: '', label: t('ticketing.boards.fields.slaPolicy.none') },
                    ...slaPolicies.map((policy): SelectOption => ({
                      value: policy.sla_policy_id,
                      label: policy.policy_name + (policy.is_default ? ' (Default)' : '')
                    }))
                  ]}
                  placeholder={t('ticketing.boards.fields.slaPolicy.placeholder')}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('ticketing.boards.fields.slaPolicy.help')}
                </p>
              </div>
            )}
            <div>
              <Label htmlFor="board-manager-picker">{t('ticketing.boards.fields.boardManager.label')}</Label>
              <UserPicker
                id="board-manager-picker"
                value={formData.manager_user_id}
                onValueChange={(value) => setFormData({ ...formData, manager_user_id: value })}
                users={users}
                userTypeFilter="internal"
                placeholder={t('ticketing.boards.fields.boardManager.placeholder')}
                buttonWidth="full"
                labelStyle="none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('ticketing.boards.fields.boardManager.help')}
              </p>
            </div>
          </div>
          </EditorAccordionSection>

          <EditorAccordionSection
            id="inbound"
            error={sectionErrors['inbound']}
            title={t('ticketing.boards.editor.sections.inbound', 'Email & inbound replies')}
            description={t('ticketing.boards.editor.sections.inboundHelp', 'Reopen tickets when clients reply by email')}
            icon={<Mail className="h-4 w-4" />}
            open={!collapsedSections.has('inbound')}
            dirty={isSectionDirty('inbound')}
            onToggle={() => toggleSection('inbound')}
            onSave={handleSaveBoard}
            saveLabel={t('ticketing.boards.editor.saveChanges', 'Save Changes')}
            unsavedLabel={t('ticketing.boards.editor.unsaved', 'Unsaved')}
            saveDisabled={saveDisabled}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="inbound_reply_reopen_enabled">{t('ticketing.boards.fields.inboundReplyReopen.enabledLabel')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('ticketing.boards.fields.inboundReplyReopen.enabledHelp')}
                  </p>
                </div>
                <Switch
                  id="inbound_reply_reopen_enabled"
                  checked={formData.inbound_reply_reopen_enabled}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, inbound_reply_reopen_enabled: checked })
                  }
                />
              </div>

              <div>
                <Label htmlFor="inbound_reply_reopen_cutoff_hours">{t('ticketing.boards.fields.inboundReplyReopen.cutoffHoursLabel')}</Label>
                <Input
                  id="inbound_reply_reopen_cutoff_hours"
                  type="number"
                  min={1}
                  value={formData.inbound_reply_reopen_cutoff_hours}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      inbound_reply_reopen_cutoff_hours: Math.max(1, parseInt(e.target.value || '168', 10) || 168),
                    })
                  }
                  disabled={!formData.inbound_reply_reopen_enabled}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('ticketing.boards.fields.inboundReplyReopen.cutoffHoursHelp')}
                </p>
              </div>

              {/* Reopen status references this board's own statuses, which only have
                  persisted ids once the board exists. Offer it on edit only; new boards
                  fall back to the default open status until they're created. */}
              {editingBoard && (
              <div>
                <Label htmlFor="inbound_reply_reopen_status_id">{t('ticketing.boards.fields.inboundReplyReopen.statusLabel')}</Label>
                <CustomSelect
                  id="inbound_reply_reopen_status_id"
                  value={formData.inbound_reply_reopen_status_id}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      inbound_reply_reopen_status_id: value,
                    })
                  }
                  options={[
                    { value: '', label: t('ticketing.boards.fields.inboundReplyReopen.statusUseDefault') },
                    ...normalizeManagedTicketStatuses(formData.ticket_statuses)
                      .filter((status) => !status.is_closed)
                      .map((status): SelectOption => ({
                        value: status.status_id || '',
                        label: status.name,
                      }))
                      .filter((option) => option.value),
                  ]}
                  placeholder={t('ticketing.boards.fields.inboundReplyReopen.statusPlaceholder')}
                  disabled={!formData.inbound_reply_reopen_enabled}
                />
              </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="inbound_reply_ai_ack_suppression_enabled">{t('ticketing.boards.fields.inboundReplyReopen.suppressAiLabel')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('ticketing.boards.fields.inboundReplyReopen.suppressAiHelp')}
                  </p>
                </div>
                <Switch
                  id="inbound_reply_ai_ack_suppression_enabled"
                  checked={formData.inbound_reply_ai_ack_suppression_enabled}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, inbound_reply_ai_ack_suppression_enabled: checked })
                  }
                  disabled={!formData.inbound_reply_reopen_enabled}
                />
              </div>
            </div>
          </EditorAccordionSection>

            {editingBoard && (
              <EditorAccordionSection
                id="close"
            error={sectionErrors['close']}
                title={t('ticketing.boards.editor.sections.close', 'Close rules')}
                description={t('ticketing.boards.editor.sections.closeHelp', 'Requirements before a ticket can be closed')}
                icon={<CheckCircle2 className="h-4 w-4" />}
                open={!collapsedSections.has('close')}
                dirty={isSectionDirty('close')}
                onToggle={() => toggleSection('close')}
                onSave={handleSaveBoard}
                saveLabel={t('ticketing.boards.editor.saveChanges', 'Save Changes')}
                unsavedLabel={t('ticketing.boards.editor.unsaved', 'Unsaved')}
                saveDisabled={saveDisabled}
              >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="close-rules-enabled">{t('ticketing.boards.closeRules.enabledLabel')}</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('ticketing.boards.closeRules.enabledHelp')}
                    </p>
                  </div>
                  <Switch
                    id="close-rules-enabled"
                    checked={closeRulesForm.is_enabled}
                    onCheckedChange={(checked) =>
                      setCloseRulesForm({ ...closeRulesForm, is_enabled: checked })
                    }
                  />
                </div>

                {([
                  ['require_resolution_comment', 'requireResolutionComment'],
                  ['require_time_entry', 'requireTimeEntry'],
                  ['require_checklist_complete', 'requireChecklistComplete'],
                  ['require_no_open_children', 'requireNoOpenChildren'],
                ] as const).map(([field, key]) => (
                  <div key={field} className="flex items-center justify-between">
                    <div>
                      <Label htmlFor={`close-rule-${field}`}>{t(`ticketing.boards.closeRules.${key}Label`)}</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t(`ticketing.boards.closeRules.${key}Help`)}
                      </p>
                    </div>
                    <Switch
                      id={`close-rule-${field}`}
                      checked={closeRulesForm[field]}
                      onCheckedChange={(checked) =>
                        setCloseRulesForm({ ...closeRulesForm, [field]: checked })
                      }
                      disabled={!closeRulesForm.is_enabled}
                    />
                  </div>
                ))}

                <div>
                  <Label>{t('ticketing.boards.closeRules.requiredFieldsLabel')}</Label>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">
                    {t('ticketing.boards.closeRules.requiredFieldsHelp')}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {CLOSE_RULE_REQUIRED_FIELDS.map((field) => (
                      <div key={field} className="flex items-center gap-2">
                        <Checkbox
                          id={`close-rule-required-${field}`}
                          checked={closeRulesForm.required_fields.includes(field)}
                          disabled={!closeRulesForm.is_enabled}
                          onChange={(event) => {
                            const checked = (event.target as HTMLInputElement).checked;
                            setCloseRulesForm((prev) => ({
                              ...prev,
                              required_fields: checked
                                ? [...prev.required_fields, field]
                                : prev.required_fields.filter((f) => f !== field),
                            }));
                          }}
                        />
                        <Label htmlFor={`close-rule-required-${field}`}>
                          {CLOSE_RULE_REQUIRED_FIELD_LABELS[field]}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </EditorAccordionSection>
            )}

            {editingBoard && autoCloseRulesUiEnabled && (
              <EditorAccordionSection
                id="automation"
            error={sectionErrors['automation']}
                title={t('ticketing.boards.editor.sections.automation', 'Automation')}
                description={t('ticketing.boards.editor.sections.automationHelp', 'Auto-close stale tickets after inactivity')}
                icon={<Zap className="h-4 w-4" />}
                open={!collapsedSections.has('automation')}
                dirty={isSectionDirty('automation')}
                onToggle={() => toggleSection('automation')}
                onSave={handleSaveBoard}
                saveLabel={t('ticketing.boards.editor.saveChanges', 'Save Changes')}
                unsavedLabel={t('ticketing.boards.editor.unsaved', 'Unsaved')}
                saveDisabled={saveDisabled}
              >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t('ticketing.boards.closeRules.autoCloseLabel')}</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('ticketing.boards.closeRules.autoCloseHelp')}
                    </p>
                  </div>
                  <Button
                    id="add-auto-close-rule-button"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setAutoCloseRulesForm((prev) => [...prev, createEmptyAutoCloseRule(prev.length)])
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t('ticketing.boards.closeRules.addAutoCloseRule')}
                  </Button>
                </div>

                {autoCloseRulesForm.map((rule, index) => {
                  const managedStatuses = normalizeManagedTicketStatuses(formData.ticket_statuses);
                  const openStatusOptions = managedStatuses
                    .filter((status) => !status.is_closed && status.status_id)
                    .map((status): SelectOption => ({ value: status.status_id || '', label: status.name }));
                  const closedStatusOptions = managedStatuses
                    .filter((status) => status.is_closed && status.status_id)
                    .map((status): SelectOption => ({ value: status.status_id || '', label: status.name }));
                  const updateRule = (updates: Partial<EditableAutoCloseRule>) =>
                    setAutoCloseRulesForm((prev) =>
                      prev.map((r) => (r.temp_id === rule.temp_id ? { ...r, ...updates } : r))
                    );

                  return (
                    <div key={rule.temp_id} className="space-y-2 rounded-md border border-gray-100 bg-gray-50 p-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor={`auto-close-trigger-${index}`}>{t('ticketing.boards.closeRules.triggerStatusLabel')}</Label>
                          <CustomSelect
                            id={`auto-close-trigger-${index}`}
                            value={rule.trigger_status_id}
                            onValueChange={(value) => updateRule({ trigger_status_id: value })}
                            options={openStatusOptions}
                            placeholder={t('ticketing.boards.closeRules.triggerStatusPlaceholder')}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`auto-close-target-${index}`}>{t('ticketing.boards.closeRules.targetStatusLabel')}</Label>
                          <CustomSelect
                            id={`auto-close-target-${index}`}
                            value={rule.close_to_status_id}
                            onValueChange={(value) => updateRule({ close_to_status_id: value })}
                            options={closedStatusOptions}
                            placeholder={t('ticketing.boards.closeRules.targetStatusPlaceholder')}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`auto-close-days-${index}`}>{t('ticketing.boards.closeRules.inactivityDaysLabel')}</Label>
                          <Input
                            id={`auto-close-days-${index}`}
                            type="number"
                            min={1}
                            value={rule.inactivity_days}
                            onChange={(e) =>
                              updateRule({ inactivity_days: Math.max(1, parseInt(e.target.value || '1', 10) || 1) })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`auto-close-warning-${index}`}>{t('ticketing.boards.closeRules.warningDaysLabel')}</Label>
                          <Input
                            id={`auto-close-warning-${index}`}
                            type="number"
                            min={1}
                            value={rule.warning_days_before ?? ''}
                            placeholder={t('ticketing.boards.closeRules.warningDaysPlaceholder')}
                            onChange={(e) => {
                              const raw = e.target.value;
                              updateRule({
                                warning_days_before: raw === '' ? null : Math.max(1, parseInt(raw, 10) || 1),
                              });
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`auto-close-enabled-${index}`}
                            checked={rule.is_enabled}
                            onCheckedChange={(checked) => updateRule({ is_enabled: checked })}
                          />
                          <Label htmlFor={`auto-close-enabled-${index}`}>
                            {t('ticketing.boards.closeRules.ruleEnabledLabel')}
                          </Label>
                        </div>
                        <Button
                          id={`remove-auto-close-rule-${index}`}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (rule.rule_id) {
                              setRemovedAutoCloseRuleIds((prev) => [...prev, rule.rule_id!]);
                            }
                            setAutoCloseRulesForm((prev) => prev.filter((r) => r.temp_id !== rule.temp_id));
                          }}
                        >
                          {t('ticketing.boards.closeRules.removeRule')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              </EditorAccordionSection>
            )}

          <EditorAccordionSection
            id="statuses"
            error={sectionErrors['statuses']}
            required={!editingBoard}
            requiredLabel={t('ticketing.boards.editor.required', 'Required')}
            title={t('ticketing.boards.editor.sections.statuses', 'Priorities & statuses')}
            description={t('ticketing.boards.editor.sections.statusesHelp', 'Default priority and the ticket statuses for this board')}
            icon={<ListChecks className="h-4 w-4" />}
            open={!collapsedSections.has('statuses')}
            dirty={isSectionDirty('statuses')}
            onToggle={() => toggleSection('statuses')}
            onSave={handleSaveBoard}
            saveLabel={t('ticketing.boards.editor.saveChanges', 'Save Changes')}
            unsavedLabel={t('ticketing.boards.editor.unsaved', 'Unsaved')}
            saveDisabled={saveDisabled}
          >
          <div className="space-y-4">
            <div>
              <Label htmlFor="default-priority-select">{t('ticketing.boards.fields.defaultPriority.label')}</Label>
              <CustomSelect
                id="default-priority-select"
                label=""
                value={formData.default_priority_id}
                onValueChange={(value) => setFormData({ ...formData, default_priority_id: value })}
                options={((): SelectOption[] => {
                  const effectivePriorityType: PriorityType = editingBoard
                    ? formData.priority_type
                    : (formData.is_itil_compliant ? 'itil' : 'custom');

                  const allowed = priorities.filter(p => {
                    if (p.item_type !== 'ticket') return false;
                    const isItil = !!p.is_from_itil_standard;
                    return effectivePriorityType === 'itil' ? isItil : !isItil;
                  });

                  return [
                    { value: '', label: t('ticketing.boards.fields.defaultPriority.none') },
                    ...allowed
                      .slice()
                      .sort((a, b) => (a.order_number - b.order_number) || a.priority_name.localeCompare(b.priority_name))
                      .map(p => ({ value: p.priority_id, label: p.priority_name }))
                  ];
                })()}
                placeholder={t('ticketing.boards.fields.defaultPriority.placeholder')}
                data-automation-id="board-default-priority-select"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('ticketing.boards.fields.defaultPriority.help')}
              </p>
            </div>

            {!editingBoard && (
              <div>
                <Label required>{t('ticketing.boards.fields.ticketStatusSetup.label')}</Label>
                <ViewSwitcher
                  currentView={formData.status_seed_mode}
                  onChange={(value) => {
                    if (value !== 'copy_existing' && value !== 'create_inline') {
                      return;
                    }
                    const nextMode = value as TicketStatusSeedMode;
                    setFormData((prev) => ({
                      ...prev,
                      status_seed_mode: nextMode,
                      ticket_statuses: nextMode === 'create_inline' && prev.ticket_statuses.length === 0
                        ? [createManagedTicketStatus(0)]
                        : prev.ticket_statuses,
                    }));
                  }}
                  options={[
                    { value: 'copy_existing', label: t('ticketing.boards.fields.ticketStatusSetup.copyExisting'), id: 'ticket-status-seed-mode-copy-existing' },
                    { value: 'create_inline', label: t('ticketing.boards.fields.ticketStatusSetup.createInline'), id: 'ticket-status-seed-mode-create-inline' },
                  ]}
                  aria-label={t('ticketing.boards.fields.ticketStatusSetup.label')}
                  className="mt-2 w-fit"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('ticketing.boards.fields.ticketStatusSetup.help')}
                </p>
              </div>
            )}

            {!editingBoard && formData.status_seed_mode === 'copy_existing' && (
              <div>
                <Label htmlFor="copy-ticket-statuses-select" required>{t('ticketing.boards.fields.copyTicketStatuses.label')}</Label>
                <CustomSelect
                  id="copy-ticket-statuses-select"
                  value={formData.copy_ticket_statuses_from_board_id}
                  onValueChange={async (value) => {
                    setError(null);
                    setFormData((prev) => ({
                      ...prev,
                      copy_ticket_statuses_from_board_id: value,
                      ticket_statuses: value ? prev.ticket_statuses : [],
                    }));

                    if (!value) {
                      return;
                    }

                    await loadManagedTicketStatusesFromBoard(value);
                  }}
                  options={[
                    { value: '', label: boards.length > 0 ? t('ticketing.boards.fields.copyTicketStatuses.selectSource') : t('ticketing.boards.fields.copyTicketStatuses.noSourceAvailable') },
                    ...boards
                      .slice()
                      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || (a.board_name || '').localeCompare(b.board_name || ''))
                      .map((board): SelectOption => ({
                        value: board.board_id || '',
                        label: board.board_name || t('ticketing.boards.fields.copyTicketStatuses.unnamedBoard')
                      }))
                  ]}
                  placeholder={t('ticketing.boards.fields.copyTicketStatuses.selectSource')}
                  disabled={boards.length === 0}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('ticketing.boards.fields.copyTicketStatuses.help')}
                </p>
              </div>
            )}

            {shouldManageTicketStatuses && (
              <div className="space-y-3 rounded-md border border-gray-200 p-4 bg-gray-50/50">
                <div>
                  <Label>
                    {editingBoard
                      ? t('ticketing.boards.fields.ticketStatuses.labelEditing')
                      : formData.status_seed_mode === 'copy_existing'
                        ? t('ticketing.boards.fields.ticketStatuses.labelCopied')
                        : t('ticketing.boards.fields.ticketStatuses.labelInline')}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {editingBoard
                      ? t('ticketing.boards.fields.ticketStatuses.helpEditing')
                      : formData.status_seed_mode === 'copy_existing'
                        ? t('ticketing.boards.fields.ticketStatuses.helpCopied')
                        : t('ticketing.boards.fields.ticketStatuses.helpInline')}
                  </p>
                </div>

                {isLoadingBoardStatuses ? (
                  <p className="text-sm text-muted-foreground">{t('ticketing.boards.fields.ticketStatuses.loading')}</p>
                ) : formData.ticket_statuses.map((status, index) => (
                  <div key={status.temp_id} className="grid gap-3 rounded-md border border-gray-200 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                    <div>
                      <Label htmlFor={`inline-ticket-status-name-${index}`}>{t('ticketing.boards.fields.ticketStatuses.statusName')}</Label>
                      <Input
                        id={`inline-ticket-status-name-${index}`}
                        value={status.name}
                        onChange={(event) => updateManagedTicketStatus(status.temp_id, { name: event.target.value })}
                        placeholder={t('ticketing.boards.fields.ticketStatuses.statusName')}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`inline-ticket-status-closed-${index}`}>{t('ticketing.boards.fields.ticketStatuses.closed')}</Label>
                      <Switch
                        id={`inline-ticket-status-closed-${index}`}
                        checked={status.is_closed}
                        onCheckedChange={(checked) => updateManagedTicketStatus(status.temp_id, { is_closed: checked })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`inline-ticket-status-default-${index}`}>{t('ticketing.boards.fields.ticketStatuses.default')}</Label>
                      <Switch
                        id={`inline-ticket-status-default-${index}`}
                        checked={status.is_default}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setManagedDefaultStatus(status.temp_id);
                          }
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        id={`move-inline-ticket-status-up-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => moveManagedTicketStatus(status.temp_id, 'up')}
                        disabled={index === 0}
                      >
                        {t('ticketing.boards.actions.up')}
                      </Button>
                      <Button
                        id={`move-inline-ticket-status-down-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => moveManagedTicketStatus(status.temp_id, 'down')}
                        disabled={index === formData.ticket_statuses.length - 1}
                      >
                        {t('ticketing.boards.actions.down')}
                      </Button>
                      <Button
                        id={`remove-inline-ticket-status-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => removeManagedTicketStatus(status.temp_id)}
                        disabled={formData.ticket_statuses.length === 1}
                      >
                        {t('ticketing.boards.actions.remove')}
                      </Button>
                    </div>
                  </div>
                ))}

                {!isLoadingBoardStatuses && (
                  <div className="flex justify-start">
                    <Button id="add-inline-ticket-status-button" type="button" variant="outline" onClick={addManagedTicketStatus}>
                      {t('ticketing.boards.actions.addStatus')}
                    </Button>
                  </div>
                )}

                {ticketStatusValidationError && !isLoadingBoardStatuses && (
                  <p className="text-sm text-red-600" data-testid="ticket-status-validation-error">
                    {t(TICKET_STATUS_VALIDATION_KEYS[ticketStatusValidationError])}
                  </p>
                )}
              </div>
            )}
          </div>
          </EditorAccordionSection>

          <EditorAccordionSection
            id="display"
            error={sectionErrors['display']}
            title={t('ticketing.boards.editor.sections.display', 'Display & behaviour')}
            description={t('ticketing.boards.editor.sections.displayHelp', 'Live timer and board type')}
            icon={<Clock className="h-4 w-4" />}
            open={!collapsedSections.has('display')}
            dirty={isSectionDirty('display')}
            onToggle={() => toggleSection('display')}
            onSave={handleSaveBoard}
            saveLabel={t('ticketing.boards.editor.saveChanges', 'Save Changes')}
            unsavedLabel={t('ticketing.boards.editor.unsaved', 'Unsaved')}
            saveDisabled={saveDisabled}
          >
            <div className="space-y-4">

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enable_live_ticket_timer">{t('ticketing.boards.fields.liveTimer.label')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('ticketing.boards.fields.liveTimer.help')}
                  </p>
                </div>
                <Switch
                  id="enable_live_ticket_timer"
                  checked={formData.enable_live_ticket_timer}
                  onCheckedChange={(checked) => setFormData({ ...formData, enable_live_ticket_timer: checked })}
                />
              </div>

              {/* ITIL Configuration - Only show for new boards */}
              {!editingBoard && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="is_itil_compliant">{t('ticketing.boards.fields.itilCompliant')}</Label>
                    <button
                      type="button"
                      onClick={() => setShowItilInfoModal(true)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      title={t('ticketing.boards.itilInfo.tooltip')}
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                  </div>
                  <Switch
                    id="is_itil_compliant"
                    checked={formData.is_itil_compliant}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_itil_compliant: checked })}
                  />
                </div>
              )}
            </div>
          </EditorAccordionSection>
        </div>

        {/* Sticky whole-board save bar */}
        <div className="sticky bottom-0 -mx-6 border-t border-gray-200 bg-white/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              {anyDirty ? (
                <><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />{t('ticketing.boards.editor.unsavedShort', 'Unsaved changes')}</>
              ) : (
                <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />{t('ticketing.boards.editor.allSaved', 'All changes saved')}</>
              )}
            </p>
            <div className="flex gap-2">
              <Button id="cancel-board-dialog" variant="outline" onClick={closeEditor}>
                {t('ticketing.boards.actions.cancel')}
              </Button>
              <Button id="save-board-button" onClick={handleSaveBoard} disabled={saveDisabled}>
                <span className={anyDirty ? 'font-bold' : ''}>
                  {editingBoard
                    ? (anyDirty
                        ? `${t('ticketing.boards.editor.saveChanges', 'Save Changes')} *`
                        : t('ticketing.boards.editor.saveChanges', 'Save Changes'))
                    : t('ticketing.boards.actions.create')}
                </span>
              </Button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Import Dialog */}
      <Dialog
        isOpen={showImportDialog && importConflicts.length === 0}
        onClose={() => {
          setShowImportDialog(false);
          setSelectedImportBoards([]);
        }}
        title={t('ticketing.boards.dialog.importTitle')}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-import-dialog"
              variant="outline"
              onClick={() => {
                setShowImportDialog(false);
                setSelectedImportBoards([]);
                setImportBoardItilSettings({});
              }}
            >
              {t('ticketing.boards.actions.cancel')}
            </Button>
            <Button
              id="import-selected-boards"
              onClick={handleImport}
              disabled={selectedImportBoards.length === 0}
            >
              {t('ticketing.boards.actions.importSelected')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            {!availableReferenceBoards || availableReferenceBoards.length === 0 ? (
              <p className="text-muted-foreground">{t('ticketing.boards.dialog.importEmpty')}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('ticketing.boards.dialog.importDescription')}
                </p>
                <div className="border rounded-md">
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8">
                      <Checkbox
                        id="select-all-boards"
                        checked={availableReferenceBoards.length > 0 && selectedImportBoards.length === availableReferenceBoards.length}
                        onChange={(e) => {
                          if ((e.target as HTMLInputElement).checked) {
                            setSelectedImportBoards(availableReferenceBoards.map(ch => ch.id));
                          } else {
                            setSelectedImportBoards([]);
                          }
                        }}
                      />
                    </div>
                    <div className="flex-1">{t('ticketing.boards.table.name')}</div>
                    <div className="flex-1">{t('ticketing.boards.table.description')}</div>
                    <div className="w-20 text-center">{t('ticketing.boards.importTable.active')}</div>
                    <div className="w-20 text-center">{t('ticketing.boards.table.default')}</div>
                    <div className="w-24 text-center">
                      <div className="flex items-center justify-center gap-1">
                        ITIL
                        <button
                          type="button"
                          onClick={() => setShowItilInfoModal(true)}
                          className="text-gray-400 hover:text-gray-600 transition-colors"
                          title={t('ticketing.boards.itilInfo.tooltip')}
                        >
                          <HelpCircle className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="w-16 text-center">{t('ticketing.boards.table.order')}</div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {availableReferenceBoards.map((board) => (
                      <div 
                        key={board.id} 
                        className="flex items-center space-x-2 p-2 hover:bg-muted/30 border-b"
                      >
                        <div className="w-8">
                          <Checkbox
                            id={`import-board-${board.id}`}
                            checked={selectedImportBoards.includes(board.id)}
                            onChange={(e) => {
                              if ((e.target as HTMLInputElement).checked) {
                                setSelectedImportBoards([...selectedImportBoards, board.id]);
                              } else {
                                setSelectedImportBoards(selectedImportBoards.filter(id => id !== board.id));
                              }
                            }}
                          />
                        </div>
                        <div className="flex-1">{board.board_name}</div>
                        <div className="flex-1 text-sm text-muted-foreground">
                          {board.description || '-'}
                        </div>
                        <div className="w-20 text-center">
                          <Switch
                            checked={!board.is_inactive}
                            disabled
                            className="data-[state=checked]:bg-primary-500"
                          />
                        </div>
                        <div className="w-20 text-center">
                          <Switch
                            checked={board.is_default || false}
                            disabled
                            className="data-[state=checked]:bg-primary-500"
                          />
                        </div>
                        <div className="w-24 text-center">
                          <Switch
                            checked={importBoardItilSettings[board.id] || false}
                            onCheckedChange={(checked) => {
                              setImportBoardItilSettings(prev => ({
                                ...prev,
                                [board.id]: checked
                              }));
                            }}
                            className="data-[state=checked]:bg-blue-500"
                          />
                        </div>
                        <div className="w-16 text-center text-sm text-muted-foreground">
                          {board.display_order}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog
        isOpen={importConflicts.length > 0}
        onClose={() => {
          setImportConflicts([]);
          setConflictResolutions({});
        }}
        title={t('ticketing.boards.dialog.conflictsTitle')}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-conflict-dialog"
              variant="outline"
              onClick={() => {
                setImportConflicts([]);
                setConflictResolutions({});
              }}
            >
              {t('ticketing.boards.actions.cancel')}
            </Button>
            <Button id="import-with-resolutions" onClick={handleImport}>
              {t('ticketing.boards.dialog.importWithResolutions')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('ticketing.boards.dialog.conflictsDescription')}
            </p>
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {importConflicts.map((conflict) => {
                const itemId = conflict.referenceItem.id;
                const resolution = conflictResolutions[itemId];
                
                return (
                  <div key={itemId} className="border rounded-lg p-4 space-y-3">
                    <div className="font-medium">{conflict.referenceItem.board_name}</div>
                    
                    {conflict.conflictType === 'name' && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          {t('ticketing.boards.dialog.nameConflict')}
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-center space-x-2">
                            <input
                              type="radio"
                              name={`conflict-${itemId}`}
                              checked={resolution?.action === 'skip'}
                              onChange={() => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { action: 'skip' }
                              })}
                            />
                            <span>{t('ticketing.boards.dialog.skipItem')}</span>
                          </label>
                          <label className="flex items-center space-x-2">
                            <input
                              type="radio"
                              name={`conflict-${itemId}`}
                              checked={resolution?.action === 'rename'}
                              onChange={() => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { action: 'rename', newName: conflict.referenceItem.board_name + ' (2)' }
                              })}
                            />
                            <span>{t('ticketing.boards.dialog.importNewName')}</span>
                          </label>
                          {resolution?.action === 'rename' && (
                            <Input
                              value={resolution.newName || ''}
                              onChange={(e) => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { ...resolution, newName: e.target.value }
                              })}
                              className="ml-6"
                            />
                          )}
                        </div>
                      </div>
                    )}
                    
                    {conflict.conflictType === 'order' && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          {t('ticketing.boards.dialog.orderConflict', { order: conflict.referenceItem.display_order })}
                        </p>
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name={`conflict-${itemId}`}
                            checked={resolution?.action === 'reorder'}
                            onChange={() => setConflictResolutions({
                              ...conflictResolutions,
                              [itemId]: { action: 'reorder', newOrder: conflict.suggestedOrder }
                            })}
                          />
                          <span>{t('ticketing.boards.dialog.importWithOrder', { order: conflict.suggestedOrder })}</span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ITIL Information Modal */}
      <Dialog
        isOpen={showItilInfoModal}
        onClose={() => setShowItilInfoModal(false)}
        title={t('ticketing.boards.itilInfo.title')}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="close-itil-info" onClick={() => setShowItilInfoModal(false)}>
              {t('ticketing.boards.actions.close')}
            </Button>
          </div>
        )}
      >
        <DialogContent className="max-w-4xl">
          <div className="space-y-6">
            {/* ITIL Categories Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('ticketing.boards.itilInfo.categoriesTitle')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Hardware */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Hardware</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Server</li>
                    <li>• Desktop/Laptop</li>
                    <li>• Network Equipment</li>
                    <li>• Printer</li>
                    <li>• Storage</li>
                    <li>• Mobile Device</li>
                  </ul>
                </div>

                {/* Software */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Software</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Operating System</li>
                    <li>• Business Application</li>
                    <li>• Database</li>
                    <li>• Email/Collaboration</li>
                    <li>• Security Software</li>
                    <li>• Custom Application</li>
                  </ul>
                </div>

                {/* Network */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Network</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Connectivity</li>
                    <li>• VPN</li>
                    <li>• Wi-Fi</li>
                    <li>• Internet Access</li>
                    <li>• LAN/WAN</li>
                    <li>• Firewall</li>
                  </ul>
                </div>

                {/* Security */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Security</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Malware/Virus</li>
                    <li>• Unauthorized Access</li>
                    <li>• Data Breach</li>
                    <li>• Phishing/Spam</li>
                    <li>• Policy Violation</li>
                    <li>• Account Lockout</li>
                  </ul>
                </div>

                {/* Service Request */}
                <div className="border rounded-lg p-4 md:col-span-2">
                  <h4 className="font-medium text-blue-800 mb-2">{t('ticketing.boards.itilInfo.categories.serviceRequest')}</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Access Request</li>
                      <li>• New User Setup</li>
                      <li>• Software Installation</li>
                    </ul>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Equipment Request</li>
                      <li>• Information Request</li>
                      <li>• Change Request</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* ITIL Priority Matrix Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('ticketing.boards.itilInfo.priorityMatrixTitle')}</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border border-gray-500/30">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-600 border-b border-r bg-gray-500/10"></th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine1.high')}<br/>{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine2.high')}</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine1.mediumHigh')}<br/>{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine2.mediumHigh')}</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine1.medium')}<br/>{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine2.medium')}</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine1.mediumLow')}<br/>{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine2.mediumLow')}</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine1.low')}<br/>{t('ticketing.boards.itilInfo.priorityMatrix.urgencyHeaderLine2.low')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.impact.high')}</td>
                      <td className="px-3 py-2 text-center bg-red-500/15 text-red-600 font-semibold border border-red-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.critical')}</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.high')}</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.high')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.impact.mediumHigh')}</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.high')}</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.high')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.low')}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.impact.medium')}</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.high')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.low')}</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.low')}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.impact.mediumLow')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.low')}</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.low')}</td>
                      <td className="px-3 py-2 text-center bg-gray-500/15 text-gray-600 font-semibold border border-gray-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.planning')}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">{t('ticketing.boards.itilInfo.priorityMatrix.impact.low')}</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.medium')}</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.low')}</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.low')}</td>
                      <td className="px-3 py-2 text-center bg-gray-500/15 text-gray-600 font-semibold border border-gray-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.planning')}</td>
                      <td className="px-3 py-2 text-center bg-gray-500/15 text-gray-600 font-semibold border border-gray-500/20">{t('ticketing.boards.itilInfo.priorityMatrix.priority.planning')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-sm text-gray-600 space-y-1">
                <p>{t('ticketing.boards.itilInfo.impactDescription')}</p>
                <p>{t('ticketing.boards.itilInfo.urgencyDescription')}</p>
                <p>{t('ticketing.boards.itilInfo.priorityDescription')}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BoardsSettings;
