'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition, DeletionValidationResult } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, BadgeVariant } from '@alga-psa/ui/components/Badge';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Copy,
  MoreVertical,
  Calendar,
  Zap,
  MousePointer,
  FileText,
  Clock,
  History,
  CheckSquare,
  Square
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  listWorkflowDefinitionsPagedAction,
  deleteWorkflowDefinitionAction,
  preCheckWorkflowDefinitionDeletion,
  updateWorkflowDefinitionMetadataAction
} from '@alga-psa/workflows/actions';
import { formatDistanceToNow } from 'date-fns';
import { useRouter, useSearchParams } from 'next/navigation';

// Skeleton loading component
function WorkflowListSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-7 w-24 bg-[rgb(var(--color-border-200))] rounded" />
          <div className="h-5 w-48 bg-[rgb(var(--color-border-200))] rounded" />
        </div>
        <div className="h-10 w-36 bg-[rgb(var(--color-border-200))] rounded" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-64 bg-[rgb(var(--color-border-200))] rounded" />
        <div className="h-10 w-40 bg-[rgb(var(--color-border-200))] rounded" />
        <div className="h-10 w-40 bg-[rgb(var(--color-border-200))] rounded" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[rgb(var(--color-border-200))]">
        {/* Table header */}
        <div className="h-12 bg-[rgb(var(--color-border-50))] border-b border-[rgb(var(--color-border-200))] px-6 flex items-center gap-8">
          <div className="h-4 w-32 bg-[rgb(var(--color-border-200))] rounded" />
          <div className="h-4 w-20 bg-[rgb(var(--color-border-200))] rounded" />
          <div className="h-4 w-20 bg-[rgb(var(--color-border-200))] rounded" />
          <div className="h-4 w-20 bg-[rgb(var(--color-border-200))] rounded" />
          <div className="h-4 w-28 bg-[rgb(var(--color-border-200))] rounded" />
        </div>
        {/* Table rows */}
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={`h-16 px-6 flex items-center gap-8 border-b border-[rgb(var(--color-border-100))] ${
              i % 2 === 0 ? 'bg-[rgb(var(--color-border-50))]' : 'bg-white'
            }`}
          >
            <div className="flex flex-col gap-1.5">
              <div className="h-4 w-40 bg-[rgb(var(--color-border-200))] rounded" />
              <div className="h-3 w-56 bg-[rgb(var(--color-border-100))] rounded" />
            </div>
            <div className="h-6 w-16 bg-[rgb(var(--color-border-200))] rounded-full" />
            <div className="h-4 w-12 bg-[rgb(var(--color-border-200))] rounded" />
            <div className="h-4 w-16 bg-[rgb(var(--color-border-200))] rounded" />
            <div className="h-4 w-24 bg-[rgb(var(--color-border-200))] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface WorkflowDefinitionListItem {
  workflow_id: string;
  name: string;
  description?: string | null;
  status: string;
  draft_version: number;
  published_version?: number | null;
  is_system?: boolean;
  is_visible?: boolean;
  is_paused?: boolean;
  trigger?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

type StatusFilter = 'all' | 'active' | 'draft' | 'paused';
type TriggerFilter = 'all' | 'event' | 'schedule' | 'recurring' | 'scheduled' | 'manual';
type WorkflowCounts = { total: number; active: number; draft: number; paused: number };
type SortableColumnId = 'name' | 'status' | 'updated_at' | 'created_at';

interface WorkflowListProps {
  onSelectWorkflow?: (workflowId: string) => void;
  onCreateNew?: () => void;
  onOpenEventCatalog?: () => void;
  editorBasePath?: string;
  controlPanelBasePath?: string;
}

const getStatusBadgeVariant = (status: string, isPaused?: boolean): BadgeVariant => {
  if (isPaused) return 'warning';
  switch (status) {
    case 'active':
    case 'published':
      return 'success';
    case 'draft':
      return 'secondary';
    case 'archived':
      return 'default';
    default:
      return 'default';
  }
};

type TFn = (key: string, options?: Record<string, unknown>) => string;

const getStatusLabel = (status: string, isPaused: boolean | undefined, t: TFn): string => {
  if (isPaused) return t('automation.workflowList.statusLabels.paused', { defaultValue: 'Paused' });
  switch (status) {
    case 'active':
    case 'published':
      return t('automation.workflowList.statusLabels.active', { defaultValue: 'Active' });
    case 'draft':
      return t('automation.workflowList.statusLabels.draft', { defaultValue: 'Draft' });
    case 'archived':
      return t('automation.workflowList.statusLabels.archived', { defaultValue: 'Archived' });
    default:
      return status;
  }
};

const getTriggerIcon = (trigger?: Record<string, unknown> | null) => {
  if (!trigger) return <MousePointer className="w-4 h-4 text-[rgb(var(--color-text-400))]" />;

  const triggerType = trigger.type as string | undefined;
  if (triggerType === 'schedule') {
    return <Calendar className="w-4 h-4 text-[rgb(var(--color-secondary-500))]" />;
  }
  if (triggerType === 'recurring') {
    return <Clock className="w-4 h-4 text-[rgb(var(--color-secondary-500))]" />;
  }
  if (triggerType === 'event') {
    return <Zap className="w-4 h-4 text-[rgb(var(--color-accent-500))]" />;
  }
  return <MousePointer className="w-4 h-4 text-[rgb(var(--color-text-400))]" />;
};

const getTriggerLabel = (trigger: Record<string, unknown> | null | undefined, t: TFn): string => {
  if (!trigger) return t('automation.workflowList.triggerLabels.manual', { defaultValue: 'Manual' });

  const triggerType = trigger.type as string | undefined;
  if (triggerType === 'schedule') {
    return t('automation.workflowList.triggerLabels.schedule', { defaultValue: 'One-time schedule' });
  }
  if (triggerType === 'recurring') {
    return t('automation.workflowList.triggerLabels.recurring', { defaultValue: 'Recurring schedule' });
  }
  if (triggerType === 'event') {
    return t('automation.workflowList.triggerLabels.event', { defaultValue: 'Event' });
  }
  return t('automation.workflowList.triggerLabels.manual', { defaultValue: 'Manual' });
};

export default function WorkflowList({
  onSelectWorkflow,
  onCreateNew,
  onOpenEventCatalog,
  editorBasePath = '/msp/workflow-editor',
  controlPanelBasePath = '/msp/workflow-control'
}: WorkflowListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation('msp/workflows');
  const didUnmount = useRef(false);
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize state from URL params
  const [workflows, setWorkflows] = useState<WorkflowDefinitionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get('status') as StatusFilter) || 'all'
  );
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>(
    (searchParams.get('trigger') as TriggerFilter) || 'all'
  );
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const [sortBy, setSortBy] = useState<SortableColumnId>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [totalItems, setTotalItems] = useState(0);
  const [counts, setCounts] = useState<WorkflowCounts>({ total: 0, active: 0, draft: 0, paused: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  // Bulk selection state
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());

  // Delete confirmation state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowDefinitionListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const statusOptions = [
    { value: 'all', label: t('automation.workflowList.statusFilter.all', { defaultValue: 'All statuses' }) },
    { value: 'active', label: t('automation.workflowList.statusFilter.active', { defaultValue: 'Active' }) },
    { value: 'draft', label: t('automation.workflowList.statusFilter.draft', { defaultValue: 'Draft' }) },
    { value: 'paused', label: t('automation.workflowList.statusFilter.paused', { defaultValue: 'Paused' }) }
  ];

  const triggerOptions = [
    { value: 'all', label: t('automation.workflowList.triggerFilter.all', { defaultValue: 'All triggers' }) },
    { value: 'event', label: t('automation.workflowList.triggerFilter.event', { defaultValue: 'Event-based' }) },
    { value: 'schedule', label: t('automation.workflowList.triggerFilter.schedule', { defaultValue: 'One-time schedule' }) },
    { value: 'recurring', label: t('automation.workflowList.triggerFilter.recurring', { defaultValue: 'Recurring schedule' }) },
    { value: 'manual', label: t('automation.workflowList.triggerFilter.manual', { defaultValue: 'Manual' }) }
  ];

  // Update URL when filters change
  const updateUrlParams = (params: Record<string, string | null>) => {
    const newParams = new URLSearchParams(window.location.search);
    Object.entries(params).forEach(([key, value]) => {
      if (value && value !== 'all' && value !== '') {
        newParams.set(key, value);
      } else {
        newParams.delete(key);
      }
    });
    const newUrl = newParams.toString() ? `?${newParams.toString()}` : window.location.pathname;
    router.replace(newUrl, { scroll: false });
  };

  const clearSearchDebounce = () => {
    const timer = searchDebounceTimerRef.current;
    if (!timer) return;
    clearTimeout(timer);
    searchDebounceTimerRef.current = null;
  };

  // Server-side paging + sorting + filtering
  useEffect(() => {
    didUnmount.current = false;
    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await listWorkflowDefinitionsPagedAction({
          page: currentPage,
          pageSize,
          search: debouncedSearchTerm || undefined,
          status: statusFilter,
          trigger: triggerFilter,
          sortBy,
          sortDirection
        });

        if (didUnmount.current) return;
        const nextItems = Array.isArray((result as any)?.items)
          ? ((result as any).items as WorkflowDefinitionListItem[])
          : [];
        const nextTotalItems = Number((result as any)?.totalItems ?? 0);
        const nextCounts = (result as any)?.counts ?? { total: 0, active: 0, draft: 0, paused: 0 };

        // If we deleted the last item on the last page, clamp to the last valid page.
        const lastPage = nextTotalItems > 0 ? Math.ceil(nextTotalItems / pageSize) : 1;
        if (nextTotalItems > 0 && nextItems.length === 0 && currentPage > lastPage) {
          setCounts(nextCounts);
          setTotalItems(nextTotalItems);
          setCurrentPage(lastPage);
          setIsLoading(true);
          return;
        }

        setWorkflows(nextItems);
        setTotalItems(nextTotalItems);
        setCounts(nextCounts);
      } catch (err) {
        console.error('Failed to fetch workflows:', err);
        if (!didUnmount.current) {
          setError(t('automation.workflowList.states.errorFallback', { defaultValue: 'Failed to fetch workflows' }));
          setWorkflows([]);
          setTotalItems(0);
        }
      } finally {
        if (!didUnmount.current) {
          setIsLoading(false);
        }
      }
    };

    void run();
    return () => {
      didUnmount.current = true;
    };
  }, [currentPage, debouncedSearchTerm, pageSize, refreshKey, sortBy, sortDirection, statusFilter, triggerFilter]);

  // Debounced URL update + server fetch for search
  useEffect(() => {
    clearSearchDebounce();
    const timer = setTimeout(() => {
      updateUrlParams({ search: searchTerm });
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1);
    }, 300);
    searchDebounceTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (searchDebounceTimerRef.current === timer) {
        searchDebounceTimerRef.current = null;
      }
    };
  }, [searchTerm]);

  const handleSortChange = (newSortBy: string, newSortDirection: 'asc' | 'desc') => {
    setSortBy(newSortBy as SortableColumnId);
    setSortDirection(newSortDirection);
    setCurrentPage(1);
  };

  const handleRowClick = (workflow: WorkflowDefinitionListItem) => {
    clearSearchDebounce();
    if (onSelectWorkflow) {
      onSelectWorkflow(workflow.workflow_id);
      return;
    }
    router.push(`${editorBasePath}/${workflow.workflow_id}`);
  };

  const handleTogglePause = async (workflow: WorkflowDefinitionListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateWorkflowDefinitionMetadataAction({
        workflowId: workflow.workflow_id,
        isPaused: !workflow.is_paused
      });
      setRefreshKey((v) => v + 1);
    } catch (err) {
      console.error('Failed to toggle pause:', err);
    }
  };

  const handleDuplicate = async (workflow: WorkflowDefinitionListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Implement duplicate functionality
    console.log('Duplicate workflow:', workflow.workflow_id);
  };

  const handleViewRuns = (workflow: WorkflowDefinitionListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`${controlPanelBasePath}?section=runs`);
  };

  const handleOpenEventCatalog = () => {
    clearSearchDebounce();
    if (onOpenEventCatalog) {
      onOpenEventCatalog();
      return;
    }
    router.push(`${controlPanelBasePath}?section=event-catalog`);
  };

  // Bulk selection handlers
  const toggleWorkflowSelection = (workflowId: string) => {
    setSelectedWorkflows(prev => {
      const next = new Set(prev);
      if (next.has(workflowId)) {
        next.delete(workflowId);
      } else {
        next.add(workflowId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const ids = workflows.map((workflow) => workflow.workflow_id);
    const allSelectedOnPage = ids.length > 0 && ids.every((id) => selectedWorkflows.has(id));
    setSelectedWorkflows((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        ids.forEach((id) => next.delete(id));
        return next;
      }
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBulkPause = async () => {
    for (const workflowId of selectedWorkflows) {
      try {
        await updateWorkflowDefinitionMetadataAction({ workflowId, isPaused: true });
      } catch (err) {
        console.error(`Failed to pause workflow ${workflowId}:`, err);
      }
    }
    setSelectedWorkflows(new Set());
    setRefreshKey((v) => v + 1);
  };

  const handleBulkResume = async () => {
    for (const workflowId of selectedWorkflows) {
      try {
        await updateWorkflowDefinitionMetadataAction({ workflowId, isPaused: false });
      } catch (err) {
        console.error(`Failed to resume workflow ${workflowId}:`, err);
      }
    }
    setSelectedWorkflows(new Set());
    setRefreshKey((v) => v + 1);
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setWorkflowToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
  };

  const runDeleteValidation = async (workflowId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckWorkflowDefinitionDeletion({ workflowId });
      setDeleteValidation(result);
    } catch (err) {
      console.error('Failed to validate workflow deletion:', err);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('automation.workflowList.states.validationFailed', { defaultValue: 'Failed to validate deletion. Please try again.' }),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  };

  const handleBulkDelete = () => {
    if (selectedWorkflows.size === 0) return;
    setIsBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    const selectedWorkflowRecords = workflows.filter((workflow) => selectedWorkflows.has(workflow.workflow_id));
    const eligibleWorkflows = selectedWorkflowRecords.filter((workflow) => !workflow.is_system);

    if (eligibleWorkflows.length === 0) {
      setIsBulkDeleteDialogOpen(false);
      return;
    }

    setIsBulkDeleting(true);
    try {
      for (const workflow of eligibleWorkflows) {
        try {
          const result = await deleteWorkflowDefinitionAction({ workflowId: workflow.workflow_id });
          if (!result.success) {
            console.error(`Failed to delete workflow ${workflow.workflow_id}:`, result.message ?? result.code);
          }
        } catch (err) {
          console.error(`Failed to delete workflow ${workflow.workflow_id}:`, err);
        }
      }
      setSelectedWorkflows(new Set());
      setRefreshKey((v) => v + 1);
      setIsBulkDeleteDialogOpen(false);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleDeleteClick = (workflow: WorkflowDefinitionListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setWorkflowToDelete(workflow);
    setDeleteValidation(null);
    setIsDeleteDialogOpen(true);
    void runDeleteValidation(workflow.workflow_id);
  };

  const handleConfirmDelete = async () => {
    if (!workflowToDelete) return;

    setIsDeleting(true);
    try {
      const result = await deleteWorkflowDefinitionAction({ workflowId: workflowToDelete.workflow_id });
      if (result.success) {
        setRefreshKey((v) => v + 1);
        resetDeleteState();
        return;
      }
      setDeleteValidation(result);
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Clear bulk selection whenever the list query changes.
  useEffect(() => {
    setSelectedWorkflows(new Set());
  }, [currentPage, debouncedSearchTerm, statusFilter, triggerFilter, sortBy, sortDirection]);

  const allSelectedOnPage =
    workflows.length > 0 && workflows.every((workflow) => selectedWorkflows.has(workflow.workflow_id));

  const columns: ColumnDefinition<WorkflowDefinitionListItem>[] = [
    {
      title: (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleSelectAll();
          }}
          className="p-0.5 hover:bg-[rgb(var(--color-border-100))] rounded"
        >
          {allSelectedOnPage ? (
            <CheckSquare className="w-4 h-4 text-[rgb(var(--color-primary-500))]" />
          ) : (
            <Square className="w-4 h-4 text-[rgb(var(--color-text-400))]" />
          )}
        </button>
      ) as unknown as string,
      dataIndex: 'workflow_id',
      sortable: false,
      width: '40px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleWorkflowSelection(record.workflow_id);
          }}
          className="p-0.5 hover:bg-[rgb(var(--color-border-100))] rounded"
        >
          {selectedWorkflows.has(record.workflow_id) ? (
            <CheckSquare className="w-4 h-4 text-[rgb(var(--color-primary-500))]" />
          ) : (
            <Square className="w-4 h-4 text-[rgb(var(--color-text-400))]" />
          )}
        </button>
      )
    },
    {
      title: t('automation.workflowList.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      sortable: true,
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <Link
          href={`${editorBasePath}/${record.workflow_id}`}
          id={`workflow-list-open-${record.workflow_id}`}
          aria-label={record.name}
          className="block w-full text-left"
          onClick={(e) => {
            e.stopPropagation();
            clearSearchDebounce();
          }}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[rgb(var(--color-primary-500))]" />
              <span className="font-medium text-[rgb(var(--color-text-900))]">{record.name}</span>
              {record.is_system && (
                <Badge variant="outline" className="text-xs">{t('automation.workflowList.tableValues.system', { defaultValue: 'System' })}</Badge>
              )}
            </div>
            {record.description && (
              <span className="text-sm text-[rgb(var(--color-text-500))] line-clamp-1">
                {record.description}
              </span>
            )}
          </div>
        </Link>
      )
    },
    {
      title: t('automation.workflowList.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      sortable: true,
      width: '120px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <Badge variant={getStatusBadgeVariant(record.status, record.is_paused)}>
          {getStatusLabel(record.status, record.is_paused, t)}
        </Badge>
      )
    },
    {
      title: t('automation.workflowList.columns.version', { defaultValue: 'Version' }),
      dataIndex: 'draft_version',
      sortable: false,
      width: '100px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-[rgb(var(--color-text-700))]">
            v{record.published_version ?? record.draft_version}
          </span>
          {record.published_version && record.draft_version > record.published_version && (
            <span className="text-xs text-[rgb(var(--color-accent-500))]">
              {t('automation.workflowList.tableValues.draftVersion', { defaultValue: 'Draft: v{{version}}', version: record.draft_version })}
            </span>
          )}
        </div>
      )
    },
    {
      title: t('automation.workflowList.columns.trigger', { defaultValue: 'Trigger' }),
      dataIndex: 'trigger',
      sortable: false,
      width: '120px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex items-center gap-2">
          {getTriggerIcon(record.trigger)}
          <span className="text-sm text-[rgb(var(--color-text-600))]">
            {getTriggerLabel(record.trigger, t)}
          </span>
        </div>
      )
    },
    {
      title: t('automation.workflowList.columns.lastModified', { defaultValue: 'Last Modified' }),
      dataIndex: 'updated_at',
      sortable: true,
      width: '150px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex items-center gap-1.5 text-sm text-[rgb(var(--color-text-500))]">
          <Clock className="w-3.5 h-3.5" />
          <span>{formatDistanceToNow(new Date(record.updated_at), { addSuffix: true })}</span>
        </div>
      )
    },
    {
      title: t('automation.workflowList.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'workflow_id',
      sortable: false,
      width: '80px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="p-1.5 rounded-md hover:bg-[rgb(var(--color-border-100))] transition-colors"
                aria-label={t('automation.workflowList.rowMenu.ariaLabel', { defaultValue: 'Workflow actions' })}
              >
                <MoreVertical className="w-4 h-4 text-[rgb(var(--color-text-500))]" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[160px] bg-white rounded-lg shadow-lg border border-[rgb(var(--color-border-200))] py-1 z-50"
                sideOffset={5}
                align="end"
              >
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-50))] cursor-pointer outline-none"
                  onSelect={(e) => handleTogglePause(record, e as unknown as React.MouseEvent)}
                >
                  {record.is_paused ? (
                    <>
                      <Play className="w-4 h-4" />
                      {t('automation.workflowList.rowMenu.resume', { defaultValue: 'Resume' })}
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4" />
                      {t('automation.workflowList.rowMenu.pause', { defaultValue: 'Pause' })}
                    </>
                  )}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-50))] cursor-pointer outline-none"
                  onSelect={(e) => handleDuplicate(record, e as unknown as React.MouseEvent)}
                >
                  <Copy className="w-4 h-4" />
                  {t('automation.workflowList.rowMenu.duplicate', { defaultValue: 'Duplicate' })}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-50))] cursor-pointer outline-none"
                  onSelect={(e) => handleViewRuns(record, e as unknown as React.MouseEvent)}
                >
                  <History className="w-4 h-4" />
                  {t('automation.workflowList.rowMenu.viewRuns', { defaultValue: 'View Runs' })}
                </DropdownMenu.Item>
                {!record.is_system && (
                  <>
                    <DropdownMenu.Separator className="h-px bg-[rgb(var(--color-border-200))] my-1" />
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-destructive))] hover:bg-destructive/10 cursor-pointer outline-none"
                      onSelect={(e) => handleDeleteClick(record, e as unknown as React.MouseEvent)}
                    >
                      <Trash2 className="w-4 h-4" />
                      {t('automation.workflowList.rowMenu.delete', { defaultValue: 'Delete' })}
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )
    }
  ];

  // Loading state
  if (isLoading) {
    return (
      <ReflectionContainer id="workflow-list-loading" label="Workflow List Loading">
        <WorkflowListSkeleton />
      </ReflectionContainer>
    );
  }

  if (error) {
    return (
      <ReflectionContainer id="workflow-list-error" label="Workflow List Error State">
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-2">
            {t('automation.workflowList.states.errorTitle', { defaultValue: 'Failed to load workflows' })}
          </h3>
          <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-md mb-6">
            {error}
          </p>
          <div className="flex items-center gap-2">
            <Button id="workflow-list-retry-btn" variant="outline" onClick={() => setRefreshKey((v) => v + 1)}>
              {t('automation.workflowList.actions.retry', { defaultValue: 'Retry' })}
            </Button>
            <Button
              id="workflow-list-create-btn"
              onClick={() => {
                clearSearchDebounce();
                onCreateNew?.();
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('automation.workflowList.actions.newWorkflow', { defaultValue: 'New Workflow' })}
            </Button>
          </div>
        </div>
      </ReflectionContainer>
    );
  }

  const hasAnyWorkflows = counts.total > 0;

  // Empty state (no workflows exist for this tenant / visibility scope)
  if (!hasAnyWorkflows) {
    return (
      <ReflectionContainer id="workflow-list-empty" label="Workflow List Empty State">
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-primary-50))] flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-[rgb(var(--color-primary-500))]" />
          </div>
          <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-2">
            {t('automation.workflowList.states.emptyTitle', { defaultValue: 'No workflows yet' })}
          </h3>
          <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-md mb-6">
            {t('automation.workflowList.states.emptyDescription', { defaultValue: 'Create your first workflow to automate tasks, respond to events, and streamline your processes.' })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              id="open-event-catalog-empty-btn"
              variant="outline"
              onClick={handleOpenEventCatalog}
            >
              <Zap className="w-4 h-4 mr-2" />
              {t('automation.workflowList.actions.eventCatalog', { defaultValue: 'Event Catalog' })}
            </Button>
            <Button
              id="create-first-workflow-btn"
              onClick={() => {
                clearSearchDebounce();
                onCreateNew?.();
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('automation.workflowList.actions.createFirst', { defaultValue: 'Create Your First Workflow' })}
            </Button>
          </div>
        </div>
      </ReflectionContainer>
    );
  }

  // No results state
  const showNoResults = !isLoading && totalItems === 0 && hasAnyWorkflows;
  const selectedWorkflowRecords = workflows.filter((workflow) => selectedWorkflows.has(workflow.workflow_id));
  const bulkDeleteEligibleWorkflows = selectedWorkflowRecords.filter((workflow) => !workflow.is_system);
  const bulkDeleteSkippedWorkflows = selectedWorkflowRecords
    .filter((workflow) => workflow.is_system)
    .map((workflow) => ({
      workflowId: workflow.workflow_id,
      name: workflow.name,
      reason: t('automation.workflowList.bulk.systemWorkflowReason', { defaultValue: 'System workflow' })
    }));

  return (
    <ReflectionContainer id="workflow-list" label="Workflow List" className="h-full min-h-0">
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{t('automation.workflowList.header', { defaultValue: 'Workflows' })}</h2>
            <div className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))]">
              <span>{t('automation.workflowList.stats.total', { defaultValue: '{{count}} total', count: counts.total })}</span>
              <span className="text-[rgb(var(--color-border-300))]">•</span>
              <span className="text-success">{t('automation.workflowList.stats.active', { defaultValue: '{{count}} active', count: counts.active })}</span>
              <span className="text-[rgb(var(--color-border-300))]">•</span>
              <span className="text-[rgb(var(--color-secondary-600))]">{t('automation.workflowList.stats.draft', { defaultValue: '{{count}} draft', count: counts.draft })}</span>
              {counts.paused > 0 && (
                <>
                  <span className="text-[rgb(var(--color-border-300))]">•</span>
                  <span className="text-amber-600">{t('automation.workflowList.stats.paused', { defaultValue: '{{count}} paused', count: counts.paused })}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              id="workflow-list-open-event-catalog-btn"
              variant="outline"
              onClick={handleOpenEventCatalog}
            >
              <Zap className="w-4 h-4 mr-2" />
              {t('automation.workflowList.actions.eventCatalog', { defaultValue: 'Event Catalog' })}
            </Button>
            <Button
              id="create-workflow-btn"
              onClick={() => {
                clearSearchDebounce();
                onCreateNew?.();
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('automation.workflowList.actions.newWorkflow', { defaultValue: 'New Workflow' })}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 max-w-xs">
            <SearchInput
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('automation.workflowList.searchPlaceholder', { defaultValue: 'Search workflows...' })}
              className="w-full"
            />
          </div>
          <div className="w-40">
            <CustomSelect
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as StatusFilter);
                setCurrentPage(1);
                updateUrlParams({ status: value });
              }}
              options={statusOptions}
            />
          </div>
          <div className="w-40">
            <CustomSelect
              value={triggerFilter}
              onValueChange={(value) => {
                setTriggerFilter(value as TriggerFilter);
                setCurrentPage(1);
                updateUrlParams({ trigger: value });
              }}
              options={triggerOptions}
            />
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedWorkflows.size > 0 && (
          <div className="mb-4 p-3 bg-[rgb(var(--color-primary-50))] border border-[rgb(var(--color-primary-200))] rounded-lg flex items-center justify-between">
            <span className="text-sm text-[rgb(var(--color-primary-700))]">
              {selectedWorkflows.size === 1
                ? t('automation.workflowList.bulk.selectedSingular', { defaultValue: '{{count}} workflow selected', count: selectedWorkflows.size })
                : t('automation.workflowList.bulk.selectedPlural', { defaultValue: '{{count}} workflows selected', count: selectedWorkflows.size })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                id="bulk-pause-btn"
                variant="outline"
                size="sm"
                onClick={handleBulkPause}
              >
                <Pause className="w-3.5 h-3.5 mr-1.5" />
                {t('automation.workflowList.bulk.pause', { defaultValue: 'Pause' })}
              </Button>
              <Button
                id="bulk-resume-btn"
                variant="outline"
                size="sm"
                onClick={handleBulkResume}
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                {t('automation.workflowList.bulk.resume', { defaultValue: 'Resume' })}
              </Button>
              <Button
                id="bulk-delete-btn"
                variant="outline"
                size="sm"
                onClick={handleBulkDelete}
                className="text-[rgb(var(--color-destructive))] border-destructive/30 hover:bg-destructive/10"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {t('automation.workflowList.bulk.delete', { defaultValue: 'Delete' })}
              </Button>
              <button
                className="ml-2 text-sm text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]"
                onClick={() => setSelectedWorkflows(new Set())}
              >
                {t('automation.workflowList.bulk.clearSelection', { defaultValue: 'Clear selection' })}
              </button>
            </div>
          </div>
        )}

        {/* No results */}
        {showNoResults ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 bg-white rounded-lg border border-[rgb(var(--color-border-200))]">
            <div className="w-12 h-12 rounded-full bg-[rgb(var(--color-border-100))] flex items-center justify-center mb-3">
              <FileText className="w-6 h-6 text-[rgb(var(--color-text-400))]" />
            </div>
            <h3 className="text-base font-medium text-[rgb(var(--color-text-700))] mb-1">
              {t('automation.workflowList.states.noResultsTitle', { defaultValue: 'No workflows found' })}
            </h3>
            <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-sm">
              {t('automation.workflowList.states.noResultsDescription', { defaultValue: "Try adjusting your search or filters to find what you're looking for." })}
            </p>
            <button
              className="mt-4 text-sm text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] font-medium"
              onClick={() => {
                setSearchTerm('');
                setDebouncedSearchTerm('');
                setStatusFilter('all');
                setTriggerFilter('all');
                setCurrentPage(1);
                updateUrlParams({ search: null, status: null, trigger: null });
              }}
            >
              {t('automation.workflowList.actions.resetFilters', { defaultValue: 'Reset' })}
            </button>
          </div>
        ) : (
          /* Table */
          <div className="flex-1 min-h-0 overflow-y-auto">
            <DataTable
              id="workflow-list-table"
              data={workflows}
              columns={columns}
              pagination={true}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              pageSize={pageSize}
              totalItems={totalItems}
              onRowClick={handleRowClick}
              manualSorting={true}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
            />
          </div>
        )}

        <DeleteEntityDialog
          id={workflowToDelete ? `delete-workflow-${workflowToDelete.workflow_id}` : 'delete-workflow-dialog'}
          isOpen={isDeleteDialogOpen}
          onClose={resetDeleteState}
          onConfirmDelete={handleConfirmDelete}
          entityName={workflowToDelete?.name || t('automation.workflowList.deleteDialog.fallbackEntityName', { defaultValue: 'this workflow' })}
          validationResult={deleteValidation}
          isValidating={isDeleteValidating}
          isDeleting={isDeleting}
        />

        <ConfirmationDialog
          id="bulk-delete-workflows-dialog"
          isOpen={isBulkDeleteDialogOpen}
          onClose={() => setIsBulkDeleteDialogOpen(false)}
          onConfirm={handleConfirmBulkDelete}
          title={t('automation.workflowList.bulk.deleteDialogTitle', { defaultValue: 'Delete selected workflows' })}
          confirmLabel={bulkDeleteEligibleWorkflows.length > 0
            ? (bulkDeleteEligibleWorkflows.length === 1
              ? t('automation.workflowList.bulk.deleteConfirmSingular', { defaultValue: 'Delete {{count}} workflow', count: bulkDeleteEligibleWorkflows.length })
              : t('automation.workflowList.bulk.deleteConfirmPlural', { defaultValue: 'Delete {{count}} workflows', count: bulkDeleteEligibleWorkflows.length }))
            : t('automation.workflowList.bulk.deleteClose', { defaultValue: 'Close' })}
          cancelLabel={t('automation.workflowList.bulk.deleteCancel', { defaultValue: 'Cancel' })}
          isConfirming={isBulkDeleting}
          message={(
            <div className="space-y-3">
              <p>
                {selectedWorkflowRecords.length === 1
                  ? <>{t('automation.workflowList.bulk.selectedSummarySingular', { defaultValue: 'You selected <1>{{count}}</1> workflow.', count: selectedWorkflowRecords.length }).split(/<1>|<\/1>/).map((part, i) => i === 1 ? <strong key={i}>{part}</strong> : part)}</>
                  : <>{t('automation.workflowList.bulk.selectedSummaryPlural', { defaultValue: 'You selected <1>{{count}}</1> workflows.', count: selectedWorkflowRecords.length }).split(/<1>|<\/1>/).map((part, i) => i === 1 ? <strong key={i}>{part}</strong> : part)}</>
                }
              </p>
              <div className="space-y-1 text-sm">
                <div>
                  {t('automation.workflowList.bulk.willBeDeleted', { defaultValue: '<1>{{count}}</1> will be deleted.', count: bulkDeleteEligibleWorkflows.length }).split(/<1>|<\/1>/).map((part, i) => i === 1 ? <strong key={i}>{part}</strong> : part)}
                </div>
                <div>
                  {t('automation.workflowList.bulk.willBeSkipped', { defaultValue: '<1>{{count}}</1> will be skipped.', count: bulkDeleteSkippedWorkflows.length }).split(/<1>|<\/1>/).map((part, i) => i === 1 ? <strong key={i}>{part}</strong> : part)}
                </div>
              </div>
              {bulkDeleteSkippedWorkflows.length > 0 && (
                <div className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-3">
                  <div className="mb-2 text-sm font-medium text-[rgb(var(--color-text-700))]">{t('automation.workflowList.bulk.skippedHeading', { defaultValue: 'Skipped workflows' })}</div>
                  <ul className="space-y-1 text-sm text-[rgb(var(--color-text-600))]">
                    {bulkDeleteSkippedWorkflows.map((workflow) => (
                      <li key={workflow.workflowId}>
                        <strong>{workflow.name}</strong> — {workflow.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        />
      </div>
    </ReflectionContainer>
  );
}
