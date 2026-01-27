'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, BadgeVariant } from '@alga-psa/ui/components/Badge';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
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
  listWorkflowDefinitionsAction,
  deleteWorkflowDefinitionAction,
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
type TriggerFilter = 'all' | 'event' | 'scheduled' | 'manual';

interface WorkflowListProps {
  onSelectWorkflow?: (workflowId: string) => void;
  onCreateNew?: () => void;
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

const getStatusLabel = (status: string, isPaused?: boolean): string => {
  if (isPaused) return 'Paused';
  switch (status) {
    case 'active':
    case 'published':
      return 'Active';
    case 'draft':
      return 'Draft';
    case 'archived':
      return 'Archived';
    default:
      return status;
  }
};

const getTriggerIcon = (trigger?: Record<string, unknown> | null) => {
  if (!trigger) return <MousePointer className="w-4 h-4 text-[rgb(var(--color-text-400))]" />;

  const eventName = trigger.eventName as string | undefined;
  if (eventName?.includes('schedule') || eventName?.includes('cron')) {
    return <Calendar className="w-4 h-4 text-[rgb(var(--color-secondary-500))]" />;
  }
  if (eventName) {
    return <Zap className="w-4 h-4 text-[rgb(var(--color-accent-500))]" />;
  }
  return <MousePointer className="w-4 h-4 text-[rgb(var(--color-text-400))]" />;
};

const getTriggerLabel = (trigger?: Record<string, unknown> | null): string => {
  if (!trigger) return 'Manual';

  const eventName = trigger.eventName as string | undefined;
  if (eventName?.includes('schedule') || eventName?.includes('cron')) {
    return 'Scheduled';
  }
  if (eventName) {
    return 'Event';
  }
  return 'Manual';
};

export default function WorkflowList({ onSelectWorkflow, onCreateNew }: WorkflowListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const didUnmount = useRef(false);

  // Initialize state from URL params
  const [workflows, setWorkflows] = useState<WorkflowDefinitionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get('status') as StatusFilter) || 'all'
  );
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>(
    (searchParams.get('trigger') as TriggerFilter) || 'all'
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<string>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Bulk selection state
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());

  // Delete confirmation state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowDefinitionListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const statusOptions = [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'draft', label: 'Draft' },
    { value: 'paused', label: 'Paused' }
  ];

  const triggerOptions = [
    { value: 'all', label: 'All triggers' },
    { value: 'event', label: 'Event-based' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'manual', label: 'Manual' }
  ];

  // Update URL when filters change
  const updateUrlParams = (params: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams.toString());
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

  const fetchWorkflows = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listWorkflowDefinitionsAction();
      if (!didUnmount.current) {
        if (!Array.isArray(data)) {
          setError('Failed to fetch workflows');
        } else {
          setWorkflows(data as WorkflowDefinitionListItem[]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
      if (!didUnmount.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch workflows');
      }
    } finally {
      if (!didUnmount.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    didUnmount.current = false;
    fetchWorkflows();
    return () => {
      didUnmount.current = true;
    };
  }, []);

  // Debounced URL update for search
  useEffect(() => {
    const timer = setTimeout(() => {
      updateUrlParams({ search: searchTerm });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSortChange = (newSortBy: string, newSortDirection: 'asc' | 'desc') => {
    setSortBy(newSortBy);
    setSortDirection(newSortDirection);
    setCurrentPage(1);
  };

  const handleRowClick = (workflow: WorkflowDefinitionListItem) => {
    if (onSelectWorkflow) {
      onSelectWorkflow(workflow.workflow_id);
    }
  };

  const handleTogglePause = async (workflow: WorkflowDefinitionListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateWorkflowDefinitionMetadataAction({
        workflowId: workflow.workflow_id,
        isPaused: !workflow.is_paused
      });
      await fetchWorkflows();
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
    // Navigate to runs tab with workflow filter
    router.push(`/msp/workflows?tab=runs&workflowId=${workflow.workflow_id}`);
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
    if (selectedWorkflows.size === filteredWorkflows.length) {
      setSelectedWorkflows(new Set());
    } else {
      setSelectedWorkflows(new Set(filteredWorkflows.map(w => w.workflow_id)));
    }
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
    await fetchWorkflows();
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
    await fetchWorkflows();
  };

  const handleBulkDelete = async () => {
    for (const workflowId of selectedWorkflows) {
      const workflow = workflows.find(w => w.workflow_id === workflowId);
      if (workflow?.is_system) continue;
      try {
        await deleteWorkflowDefinitionAction({ workflowId });
      } catch (err) {
        console.error(`Failed to delete workflow ${workflowId}:`, err);
      }
    }
    setSelectedWorkflows(new Set());
    await fetchWorkflows();
  };

  const handleDeleteClick = (workflow: WorkflowDefinitionListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setWorkflowToDelete(workflow);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!workflowToDelete) return;

    setIsDeleting(true);
    try {
      await deleteWorkflowDefinitionAction({ workflowId: workflowToDelete.workflow_id });
      await fetchWorkflows();
      setIsDeleteDialogOpen(false);
      setWorkflowToDelete(null);
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter and sort workflows
  const filteredWorkflows = useMemo(() => {
    let result = [...workflows];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(w =>
        w.name.toLowerCase().includes(term) ||
        w.description?.toLowerCase().includes(term)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(w => {
        if (statusFilter === 'paused') return w.is_paused;
        if (statusFilter === 'active') return (w.status === 'active' || w.status === 'published') && !w.is_paused;
        if (statusFilter === 'draft') return w.status === 'draft' && !w.is_paused;
        return true;
      });
    }

    // Trigger filter
    if (triggerFilter !== 'all') {
      result = result.filter(w => {
        const label = getTriggerLabel(w.trigger).toLowerCase();
        return label === triggerFilter;
      });
    }

    // Sort
    result.sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortBy) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'status':
          aVal = getStatusLabel(a.status, a.is_paused);
          bVal = getStatusLabel(b.status, b.is_paused);
          break;
        case 'updated_at':
          aVal = new Date(a.updated_at).getTime();
          bVal = new Date(b.updated_at).getTime();
          break;
        case 'created_at':
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          break;
        default:
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [workflows, searchTerm, statusFilter, triggerFilter, sortBy, sortDirection]);

  // Compute counts
  const counts = useMemo(() => {
    const total = workflows.length;
    const active = workflows.filter(w => (w.status === 'active' || w.status === 'published') && !w.is_paused).length;
    const draft = workflows.filter(w => w.status === 'draft' && !w.is_paused).length;
    const paused = workflows.filter(w => w.is_paused).length;
    return { total, active, draft, paused };
  }, [workflows]);

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
          {selectedWorkflows.size === filteredWorkflows.length && filteredWorkflows.length > 0 ? (
            <CheckSquare className="w-4 h-4 text-[rgb(var(--color-primary-500))]" />
          ) : (
            <Square className="w-4 h-4 text-[rgb(var(--color-text-400))]" />
          )}
        </button>
      ) as unknown as string,
      dataIndex: 'workflow_id',
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
      title: 'Name',
      dataIndex: 'name',
      sortable: true,
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[rgb(var(--color-primary-500))]" />
            <span className="font-medium text-[rgb(var(--color-text-900))]">{record.name}</span>
            {record.is_system && (
              <Badge variant="outline" className="text-xs">System</Badge>
            )}
          </div>
          {record.description && (
            <span className="text-sm text-[rgb(var(--color-text-500))] line-clamp-1">
              {record.description}
            </span>
          )}
        </div>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      sortable: true,
      width: '120px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <Badge variant={getStatusBadgeVariant(record.status, record.is_paused)}>
          {getStatusLabel(record.status, record.is_paused)}
        </Badge>
      )
    },
    {
      title: 'Version',
      dataIndex: 'draft_version',
      width: '100px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-[rgb(var(--color-text-700))]">
            v{record.published_version ?? record.draft_version}
          </span>
          {record.published_version && record.draft_version > record.published_version && (
            <span className="text-xs text-[rgb(var(--color-accent-500))]">
              Draft: v{record.draft_version}
            </span>
          )}
        </div>
      )
    },
    {
      title: 'Trigger',
      dataIndex: 'trigger',
      width: '120px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex items-center gap-2">
          {getTriggerIcon(record.trigger)}
          <span className="text-sm text-[rgb(var(--color-text-600))]">
            {getTriggerLabel(record.trigger)}
          </span>
        </div>
      )
    },
    {
      title: 'Last Modified',
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
      title: 'Actions',
      dataIndex: 'workflow_id',
      width: '80px',
      render: (value: unknown, record: WorkflowDefinitionListItem) => (
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="p-1.5 rounded-md hover:bg-[rgb(var(--color-border-100))] transition-colors"
                aria-label="Workflow actions"
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
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4" />
                      Pause
                    </>
                  )}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-50))] cursor-pointer outline-none"
                  onSelect={(e) => handleDuplicate(record, e as unknown as React.MouseEvent)}
                >
                  <Copy className="w-4 h-4" />
                  Duplicate
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-50))] cursor-pointer outline-none"
                  onSelect={(e) => handleViewRuns(record, e as unknown as React.MouseEvent)}
                >
                  <History className="w-4 h-4" />
                  View Runs
                </DropdownMenu.Item>
                {!record.is_system && (
                  <>
                    <DropdownMenu.Separator className="h-px bg-[rgb(var(--color-border-200))] my-1" />
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-destructive))] hover:bg-red-50 cursor-pointer outline-none"
                      onSelect={(e) => handleDeleteClick(record, e as unknown as React.MouseEvent)}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
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
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-2">
            Failed to load workflows
          </h3>
          <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-md mb-6">
            {error}
          </p>
          <div className="flex items-center gap-2">
            <Button id="workflow-list-retry-btn" variant="outline" onClick={fetchWorkflows}>
              Retry
            </Button>
            <Button id="workflow-list-create-btn" onClick={onCreateNew}>
              <Plus className="w-4 h-4 mr-2" />
              New Workflow
            </Button>
          </div>
        </div>
      </ReflectionContainer>
    );
  }

  // Empty state
  if (workflows.length === 0) {
    return (
      <ReflectionContainer id="workflow-list-empty" label="Workflow List Empty State">
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-primary-50))] flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-[rgb(var(--color-primary-500))]" />
          </div>
          <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-2">
            No workflows yet
          </h3>
          <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-md mb-6">
            Create your first workflow to automate tasks, respond to events, and streamline your processes.
          </p>
          <Button
            id="create-first-workflow-btn"
            onClick={onCreateNew}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Your First Workflow
          </Button>
        </div>
      </ReflectionContainer>
    );
  }

  // No results state
  const showNoResults = !isLoading && filteredWorkflows.length === 0 && workflows.length > 0;

  return (
    <ReflectionContainer id="workflow-list" label="Workflow List" className="h-full min-h-0">
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">Workflows</h2>
            <div className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))]">
              <span>{counts.total} total</span>
              <span className="text-[rgb(var(--color-border-300))]">•</span>
              <span className="text-green-600">{counts.active} active</span>
              <span className="text-[rgb(var(--color-border-300))]">•</span>
              <span className="text-[rgb(var(--color-secondary-600))]">{counts.draft} draft</span>
              {counts.paused > 0 && (
                <>
                  <span className="text-[rgb(var(--color-border-300))]">•</span>
                  <span className="text-amber-600">{counts.paused} paused</span>
                </>
              )}
            </div>
          </div>
          <Button
            id="create-workflow-btn"
            onClick={onCreateNew}
          >
            <Plus className="w-4 h-4 mr-2" />
            New Workflow
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 max-w-xs">
            <SearchInput
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search workflows..."
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
              {selectedWorkflows.size} workflow{selectedWorkflows.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                id="bulk-pause-btn"
                variant="outline"
                size="sm"
                onClick={handleBulkPause}
              >
                <Pause className="w-3.5 h-3.5 mr-1.5" />
                Pause
              </Button>
              <Button
                id="bulk-resume-btn"
                variant="outline"
                size="sm"
                onClick={handleBulkResume}
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Resume
              </Button>
              <Button
                id="bulk-delete-btn"
                variant="outline"
                size="sm"
                onClick={handleBulkDelete}
                className="text-[rgb(var(--color-destructive))] border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
              <button
                className="ml-2 text-sm text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]"
                onClick={() => setSelectedWorkflows(new Set())}
              >
                Clear selection
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
              No workflows found
            </h3>
            <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-sm">
              Try adjusting your search or filters to find what you're looking for.
            </p>
            <button
              className="mt-4 text-sm text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] font-medium"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setTriggerFilter('all');
              }}
            >
              Clear all filters
            </button>
          </div>
        ) : (
          /* Table */
          <div className="flex-1 min-h-0 overflow-y-auto">
            <DataTable
              id="workflow-list-table"
              data={filteredWorkflows}
              columns={columns}
              pagination={true}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              pageSize={pageSize}
              totalItems={filteredWorkflows.length}
              onRowClick={handleRowClick}
              manualSorting={false}
              initialSorting={[{ id: sortBy, desc: sortDirection === 'desc' }]}
            />
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          id="delete-workflow-dialog"
          isOpen={isDeleteDialogOpen}
          onClose={() => {
            setIsDeleteDialogOpen(false);
            setWorkflowToDelete(null);
          }}
          onConfirm={handleConfirmDelete}
          title="Delete Workflow"
          message={
            workflowToDelete
              ? `Are you sure you want to delete "${workflowToDelete.name}"? This action cannot be undone.`
              : ''
          }
          confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
          isConfirming={isDeleting}
        />
      </div>
    </ReflectionContainer>
  );
}
