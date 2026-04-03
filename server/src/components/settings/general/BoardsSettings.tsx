'use client'


import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, MoreVertical, HelpCircle } from "lucide-react";
import { IBoard, ITeam, CategoryType, PriorityType, IPriority, IUser, ColumnDefinition, DeletionValidationResult, DeletionDependency } from '@alga-psa/types';
import {
  getAllBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  getBoardTicketStatuses,
} from '@alga-psa/tickets/actions';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from '@alga-psa/reference-data/actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getAllUsers, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getSlaPolicies } from '@alga-psa/sla/actions';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { ISlaPolicy } from '@alga-psa/sla/types';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Switch } from '@alga-psa/ui/components/Switch';
import { ToggleGroup, ToggleGroupItem } from '@alga-psa/ui/components/ToggleGroup';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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

function getManagedTicketStatusValidationError(statuses: ManagedTicketStatus[]): string | null {
  const normalizedStatuses = normalizeManagedTicketStatuses(statuses);

  if (normalizedStatuses.length === 0) {
    return 'Add at least one ticket status before saving the board.';
  }

  const duplicateName = normalizedStatuses.find((status, index) =>
    normalizedStatuses.findIndex((candidate) => candidate.name.toLowerCase() === status.name.toLowerCase()) !== index
  );
  if (duplicateName) {
    return 'Ticket status names must be unique within a board.';
  }

  const openDefaultStatuses = normalizedStatuses.filter((status) => status.is_default && !status.is_closed);
  if (openDefaultStatuses.length !== 1 || normalizedStatuses.some((status) => status.is_default && status.is_closed)) {
    return 'Select exactly one open default ticket status before saving the board.';
  }

  return null;
}

const BoardsSettings: React.FC = () => {
  const { t } = useTranslation('msp/settings');
  const createEmptyFormData = () => ({
    board_name: '',
    description: '',
    display_order: 0,
    is_inactive: false,
    category_type: 'custom' as CategoryType,
    priority_type: 'custom' as PriorityType,
    is_itil_compliant: false,
    default_assigned_to: '',
    default_assigned_team_id: '',
    default_priority_id: '',
    manager_user_id: '',
    sla_policy_id: '',
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
  const { enabled: teamsV2Enabled } = useFeatureFlag('teams-v2', { defaultValue: false });
  const [error, setError] = useState<string | null>(null);
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

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };
  
  // State for Add/Edit Dialog
  const [showAddEditDialog, setShowAddEditDialog] = useState(false);
  const [editingBoard, setEditingBoard] = useState<IBoard | null>(null);
  const [formData, setFormData] = useState(createEmptyFormData);
  const [isLoadingBoardStatuses, setIsLoadingBoardStatuses] = useState(false);
  
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
    if (teamsV2Enabled) {
      fetchTeams();
    }
  }, [teamsV2Enabled]);

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
      setError(loadError instanceof Error ? loadError.message : 'Failed to load board ticket statuses.');
    } finally {
      setIsLoadingBoardStatuses(false);
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
      category_type: board.category_type || 'custom',
      priority_type: board.priority_type || 'custom',
      is_itil_compliant: board.category_type === 'itil' && board.priority_type === 'itil',
      default_assigned_to: board.default_assigned_to || '',
      default_assigned_team_id: board.default_assigned_team_id || '',
      default_priority_id: board.default_priority_id || '',
      manager_user_id: board.manager_user_id || '',
      sla_policy_id: board.sla_policy_id || '',
      enable_live_ticket_timer: board.enable_live_ticket_timer ?? true,
      ticket_statuses: [],
    });
    setShowAddEditDialog(true);
    setError(null);
    setIsLoadingBoardStatuses(true);

    await loadManagedTicketStatusesFromBoard(board.board_id!);
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
          // Show confirmation dialog to force delete categories
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
          toast.error(result.message || 'Failed to delete board');
          setDeleteDialog({ isOpen: false, boardId: '', boardName: '' });
          break;
      }
    } catch (error) {
      handleError(error, 'Failed to delete board');
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

  const handleSaveBoard = async () => {
    try {
      setError(null);

      if (!formData.board_name.trim()) {
        setError(t('ticketing.boards.messages.error.nameRequired'));
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
        setError('Select an existing board to copy ticket statuses from.');
        return;
      }

      if (shouldManageTicketStatuses && ticketStatusValidationError) {
        setError(ticketStatusValidationError);
        return;
      }

      if (editingBoard) {
        await updateBoard(editingBoard.board_id!, {
          board_name: formData.board_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          category_type: categoryType,
          priority_type: priorityType,
          default_assigned_to: formData.default_assigned_to || null,
          default_assigned_team_id: formData.default_assigned_team_id || null,
          default_priority_id: formData.default_priority_id || null,
          manager_user_id: formData.manager_user_id || null,
          sla_policy_id: formData.sla_policy_id || null,
          enable_live_ticket_timer: formData.enable_live_ticket_timer,
          ticket_statuses: normalizedTicketStatuses,
        });
        toast.success(t('ticketing.boards.messages.success.updated'));
      } else {
        await createBoard({
          board_name: formData.board_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          category_type: categoryType,
          priority_type: priorityType,
          default_assigned_to: formData.default_assigned_to || null,
          default_assigned_team_id: formData.default_assigned_team_id || null,
          default_priority_id: formData.default_priority_id || null,
          manager_user_id: formData.manager_user_id || null,
          sla_policy_id: formData.sla_policy_id || null,
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
      setError(error instanceof Error ? error.message : t('ticketing.boards.messages.error.saveFailed'));
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
      handleError(error, 'Failed to import boards');
    }
  };

  const columns: ColumnDefinition<IBoard>[] = [
    {
      title: t('ticketing.boards.table.name'),
      dataIndex: 'board_name',
      render: (value: string) => (
        <span className="text-gray-700 font-medium">{value}</span>
      ),
    },
    {
      title: t('ticketing.boards.table.description'),
      dataIndex: 'description',
      render: (value: string | null) => (
        <span className="text-gray-600">{value || '-'}</span>
      ),
    },
    {
      title: t('ticketing.boards.table.status'),
      dataIndex: 'is_inactive',
      render: (value: boolean, record: IBoard) => (
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">
            {value ? t('ticketing.boards.statusLabels.inactive') : t('ticketing.boards.statusLabels.active')}
          </span>
          <Switch
            checked={!value}
            onCheckedChange={async (checked) => {
              try {
                await updateBoard(record.board_id!, {
                  is_inactive: !checked
                });
                await fetchBoards();
              } catch (error) {
                handleError(error, 'Failed to update board status');
              }
            }}
            className="data-[state=checked]:bg-primary-500"
          />
        </div>
      ),
    },
    {
      title: t('ticketing.boards.table.default'),
      dataIndex: 'is_default',
      render: (value: boolean, record: IBoard) => (
        <div className="flex items-center space-x-2">
          <Switch
            checked={value || false}
            onCheckedChange={async (checked) => {
              try {
                // Prevent unchecking if this is the only default board
                if (!checked && value) {
                  toast.error(t('ticketing.boards.messages.error.lastDefault'));
                  return;
                }

                // Backend handles unsetting other defaults atomically when setting a new one
                await updateBoard(record.board_id!, {
                  is_default: checked
                });
                await fetchBoards();
              } catch (error) {
                handleError(error, 'Failed to update default board');
              }
            }}
            className="data-[state=checked]:bg-primary-500"
          />
        </div>
      ),
    },
    {
      title: t('ticketing.boards.table.defaultAgent'),
      dataIndex: 'default_assigned_to',
      render: (value: string | null, record: IBoard) => {
        const team = record.default_assigned_team_id
          ? teams.find(t => t.team_id === record.default_assigned_team_id)
          : null;
        const user = value ? users.find(u => u.user_id === value) : null;

        if (!team && !user) return <span className="text-gray-400">-</span>;

        return (
          <span className="text-gray-700">
            {team ? team.team_name : user ? `${user.first_name} ${user.last_name}` : <span className="text-gray-400 italic">Unknown</span>}
          </span>
        );
      },
    },
    {
      title: t('ticketing.boards.table.defaultPriority'),
      dataIndex: 'default_priority_id',
      render: (value: string | null) => {
        if (!value) return <span className="text-gray-400">-</span>;
        const pr = priorities.find(p => p.priority_id === value);
        if (!pr) return <span className="text-gray-400 italic">Unknown</span>;
        return (
          <span className="text-gray-700">{pr.priority_name}</span>
        );
      },
    },
    {
      title: t('ticketing.boards.table.boardManager'),
      dataIndex: 'manager_user_id',
      render: (value: string | null) => {
        if (!value) return <span className="text-gray-400">-</span>;
        const user = users.find(u => u.user_id === value);
        return user ? (
          <span className="text-gray-700">{user.first_name} {user.last_name}</span>
        ) : (
          <span className="text-gray-400 italic">Unknown</span>
        );
      },
    },
    {
      title: t('ticketing.boards.table.order'),
      dataIndex: 'display_order',
      render: (value: number) => (
        <span className="text-gray-600">{value}</span>
      ),
    },
    {
      title: t('ticketing.boards.table.itilBoard'),
      dataIndex: 'category_type',
      render: (_, record: IBoard) => (
        record.category_type === 'itil' && record.priority_type === 'itil' ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-600">
            ITIL
          </span>
        ) : (
          <span className="text-gray-500">-</span>
        )
      ),
    },
    {
      title: t('ticketing.boards.table.actions'),
      dataIndex: 'board_id',
      width: '10%',
      render: (value: string, record: IBoard) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id="board-actions-menu" variant="ghost" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startEditing(record)}>
              {t('ticketing.boards.actions.edit')}
            </DropdownMenuItem>
            {!record.is_default && (
              <DropdownMenuItem
                onClick={() => setDeleteDialog({
                  isOpen: true,
                  boardId: value,
                  boardName: record.board_name || ''
                })}
                className="text-destructive"
              >
                {t('ticketing.boards.actions.delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">{t('ticketing.boards.title')}</h3>
        <Alert variant="info" className="mb-4">
          <AlertDescription>
            {t('ticketing.boards.alert')}
          </AlertDescription>
        </Alert>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataTable
          id="boards-settings-table"
          data={boards}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
        <div className="mt-4 flex gap-2">
          <Button 
            id="add-board-button"
            onClick={() => {
              setEditingBoard(null);
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
              setShowAddEditDialog(true);
              setIsLoadingBoardStatuses(false);
            }}
            className="bg-primary-500 text-white hover:bg-primary-600"
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
              } catch (error) {
                handleError(error, t('ticketing.boards.messages.error.fetchAvailableFailed'));
              }
            }}
          >
            {t('ticketing.boards.actions.importStandard')}
          </Button>
        </div>
      </div>

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

      {/* Add/Edit Dialog */}
      <Dialog
        isOpen={showAddEditDialog}
        onClose={() => {
          setShowAddEditDialog(false);
          setEditingBoard(null);
          setFormData(createEmptyFormData());
          setError(null);
          setIsLoadingBoardStatuses(false);
        }}
        title={editingBoard ? t('ticketing.boards.dialog.editBoard') : t('ticketing.boards.dialog.addBoard')}
      >
        <DialogContent>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="board_name">{t('ticketing.boards.fields.boardName.label')}</Label>
              <Input
                id="board_name"
                value={formData.board_name}
                onChange={(e) => setFormData({ ...formData, board_name: e.target.value })}
                placeholder={t('ticketing.boards.fields.boardName.placeholder')}
              />
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
            <div>
              <Label htmlFor="default-assigned-agent-picker">{t('ticketing.boards.fields.defaultAssignedAgent.label')}</Label>
              {teamsV2Enabled ? (
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
              ) : (
                <UserPicker
                  id="default-assigned-agent-picker"
                  value={formData.default_assigned_to}
                  onValueChange={(value) => setFormData({ ...formData, default_assigned_to: value })}
                  users={users}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  userTypeFilter="internal"
                  placeholder={t('ticketing.boards.fields.defaultAssignedAgent.placeholder')}
                  buttonWidth="full"
                  labelStyle="none"
                />
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {t('ticketing.boards.fields.defaultAssignedAgent.help')}
              </p>
            </div>
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
                <Label>Ticket status setup</Label>
                <ToggleGroup
                  type="single"
                  value={formData.status_seed_mode}
                  onValueChange={(value) => {
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
                  aria-label="Ticket status setup"
                  className="mt-2 w-full"
                >
                  <ToggleGroupItem
                    id="ticket-status-seed-mode-copy-existing"
                    value="copy_existing"
                    className="flex-1 min-w-0"
                  >
                    Copy from existing board
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    id="ticket-status-seed-mode-create-inline"
                    value="create_inline"
                    className="flex-1 min-w-0"
                  >
                    Create statuses inline
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose whether this board starts from an existing lifecycle or a new inline status list.
                </p>
              </div>
            )}

            {!editingBoard && formData.status_seed_mode === 'copy_existing' && (
              <div>
                <Label htmlFor="copy-ticket-statuses-select">Copy ticket statuses from</Label>
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
                    { value: '', label: boards.length > 0 ? 'Select a source board' : 'No source boards available' },
                    ...boards
                      .slice()
                      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || (a.board_name || '').localeCompare(b.board_name || ''))
                      .map((board): SelectOption => ({
                        value: board.board_id || '',
                        label: board.board_name || 'Unnamed board'
                      }))
                  ]}
                  placeholder="Select a source board"
                  disabled={boards.length === 0}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  New boards clone their ticket lifecycle from an existing board.
                </p>
              </div>
            )}

            {shouldManageTicketStatuses && (
              <div className="space-y-3 rounded-md border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>
                      {editingBoard
                        ? 'Board ticket statuses'
                        : formData.status_seed_mode === 'copy_existing'
                          ? 'Copied ticket statuses'
                          : 'Inline ticket statuses'}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {editingBoard
                        ? 'Edit the ticket lifecycle for this board only.'
                        : formData.status_seed_mode === 'copy_existing'
                          ? 'Review and adjust the copied lifecycle before saving the new board.'
                          : 'Author the board&apos;s initial ticket lifecycle before saving.'}
                    </p>
                  </div>
                  <Button id="add-inline-ticket-status-button" type="button" variant="outline" onClick={addManagedTicketStatus}>
                    Add Status
                  </Button>
                </div>

                {isLoadingBoardStatuses ? (
                  <p className="text-sm text-muted-foreground">Loading board ticket statuses…</p>
                ) : formData.ticket_statuses.map((status, index) => (
                  <div key={status.temp_id} className="grid gap-3 rounded-md border border-gray-200 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                    <div>
                      <Label htmlFor={`inline-ticket-status-name-${index}`}>Status name</Label>
                      <Input
                        id={`inline-ticket-status-name-${index}`}
                        value={status.name}
                        onChange={(event) => updateManagedTicketStatus(status.temp_id, { name: event.target.value })}
                        placeholder="Status name"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`inline-ticket-status-closed-${index}`}>Closed</Label>
                      <Switch
                        id={`inline-ticket-status-closed-${index}`}
                        checked={status.is_closed}
                        onCheckedChange={(checked) => updateManagedTicketStatus(status.temp_id, { is_closed: checked })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`inline-ticket-status-default-${index}`}>Default</Label>
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
                        Up
                      </Button>
                      <Button
                        id={`move-inline-ticket-status-down-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => moveManagedTicketStatus(status.temp_id, 'down')}
                        disabled={index === formData.ticket_statuses.length - 1}
                      >
                        Down
                      </Button>
                      <Button
                        id={`remove-inline-ticket-status-${index}`}
                        type="button"
                        variant="ghost"
                        onClick={() => removeManagedTicketStatus(status.temp_id)}
                        disabled={formData.ticket_statuses.length === 1}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}

                {ticketStatusValidationError && !isLoadingBoardStatuses && (
                  <p className="text-sm text-red-600" data-testid="ticket-status-validation-error">
                    {ticketStatusValidationError}
                  </p>
                )}
              </div>
            )}

            <div className="border-t pt-4 space-y-4">
              <h4 className="font-medium text-gray-800">{t('ticketing.boards.fields.boardConfiguration')}</h4>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enable_live_ticket_timer">Enable live ticket timer</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Shows the live timer and tracked intervals on tickets in this board. Manual time entry remains available.
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
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="cancel-board-dialog"
            variant="outline"
            onClick={() => {
              setShowAddEditDialog(false);
              setEditingBoard(null);
              setFormData(createEmptyFormData());
              setError(null);
              setIsLoadingBoardStatuses(false);
            }}
          >
            {t('ticketing.boards.actions.cancel')}
          </Button>
          <Button
            id="save-board-button"
            onClick={handleSaveBoard}
            disabled={isLoadingBoardStatuses || (shouldManageTicketStatuses && Boolean(ticketStatusValidationError))}
          >
            {editingBoard ? t('ticketing.boards.actions.update') : t('ticketing.boards.actions.create')}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Import Dialog */}
      <Dialog 
        isOpen={showImportDialog && importConflicts.length === 0} 
        onClose={() => {
          setShowImportDialog(false);
          setSelectedImportBoards([]);
        }} 
        title={t('ticketing.boards.dialog.importTitle')}
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
                    <div className="w-8 [&>div]:mb-0">
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
                        <div className="w-8 [&>div]:mb-0">
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
        <DialogFooter>
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
        </DialogFooter>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog 
        isOpen={importConflicts.length > 0} 
        onClose={() => {
          setImportConflicts([]);
          setConflictResolutions({});
        }} 
        title={t('ticketing.boards.dialog.conflictsTitle')}
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
        <DialogFooter>
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
        </DialogFooter>
      </Dialog>

      {/* ITIL Information Modal */}
      <Dialog
        isOpen={showItilInfoModal}
        onClose={() => setShowItilInfoModal(false)}
        title={t('ticketing.boards.itilInfo.title')}
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
                  <h4 className="font-medium text-blue-800 mb-2">Service Request</h4>
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
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">High<br/>Urgency (1)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">Medium-High<br/>Urgency (2)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">Medium<br/>Urgency (3)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">Medium-Low<br/>Urgency (4)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-500/10">Low<br/>Urgency (5)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">High Impact (1)</td>
                      <td className="px-3 py-2 text-center bg-red-500/15 text-red-600 font-semibold border border-red-500/20">Critical (1)</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">High (2)</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">High (2)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">Medium-High Impact (2)</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">High (2)</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">High (2)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">Low (4)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">Medium Impact (3)</td>
                      <td className="px-3 py-2 text-center bg-orange-500/15 text-orange-600 font-semibold border border-orange-500/20">High (2)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">Low (4)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">Medium-Low Impact (4)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-gray-500/15 text-gray-600 font-semibold border border-gray-500/20">Planning (5)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-500/10">Low Impact (5)</td>
                      <td className="px-3 py-2 text-center bg-yellow-500/15 text-yellow-600 font-semibold border border-yellow-500/20">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-blue-500/15 text-blue-600 font-semibold border border-blue-500/20">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-gray-500/15 text-gray-600 font-semibold border border-gray-500/20">Planning (5)</td>
                      <td className="px-3 py-2 text-center bg-gray-500/15 text-gray-600 font-semibold border border-gray-500/20">Planning (5)</td>
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
        <DialogFooter>
          <Button id="close-itil-info" onClick={() => setShowItilInfoModal(false)}>
            {t('ticketing.boards.actions.close')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

export default BoardsSettings;
