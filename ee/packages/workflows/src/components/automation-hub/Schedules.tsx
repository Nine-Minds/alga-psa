'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { CalendarClock, Clock3, MoreVertical, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DeleteEntityDialog } from '@alga-psa/ui';
import type { ColumnDefinition, DeletionValidationResult } from '@alga-psa/types';
import type { WorkflowScheduleStateRecord } from '@alga-psa/workflows/persistence';
import {
  createWorkflowScheduleAction as createWorkflowScheduleActionDefault,
  deleteWorkflowScheduleAction as deleteWorkflowScheduleActionDefault,
  getWorkflowScheduleAction as getWorkflowScheduleActionDefault,
  listWorkflowDefinitionsPagedAction,
  listWorkflowSchedulesAction as listWorkflowSchedulesActionDefault,
  pauseWorkflowScheduleAction as pauseWorkflowScheduleActionDefault,
  resumeWorkflowScheduleAction as resumeWorkflowScheduleActionDefault,
  updateWorkflowScheduleAction as updateWorkflowScheduleActionDefault
} from '@alga-psa/workflows/actions';
import WorkflowScheduleDialog, { type WorkflowScheduleDialogActions } from './WorkflowScheduleDialog';

type WorkflowOption = {
  workflow_id: string;
  name: string;
};

type WorkflowScheduleListItem = WorkflowScheduleStateRecord & {
  workflow_name?: string | null;
};

type StatusFilter = 'all' | 'enabled' | 'paused' | 'failed' | 'completed' | 'disabled';
type TriggerFilter = 'all' | 'schedule' | 'recurring';
export type WorkflowSchedulesActions = WorkflowScheduleDialogActions & {
  deleteWorkflowScheduleAction: typeof deleteWorkflowScheduleActionDefault;
  listWorkflowSchedulesAction: typeof listWorkflowSchedulesActionDefault;
  pauseWorkflowScheduleAction: typeof pauseWorkflowScheduleActionDefault;
  resumeWorkflowScheduleAction: typeof resumeWorkflowScheduleActionDefault;
};

type SchedulesProps = {
  scheduleActions?: WorkflowSchedulesActions;
};

const SCHEDULE_SEARCH_PARAM = 'scheduleSearch';
const SCHEDULE_STATUS_PARAM = 'scheduleStatus';
const SCHEDULE_TRIGGER_PARAM = 'scheduleTrigger';
const SCHEDULE_WORKFLOW_PARAM = 'scheduleWorkflowId';

const getScheduleStatusVariant = (schedule: WorkflowScheduleListItem): BadgeVariant => {
  if (!schedule.enabled || schedule.status === 'paused') return 'warning';
  if (schedule.status === 'failed' || schedule.last_error) return 'error';
  if (schedule.status === 'completed') return 'secondary';
  return 'success';
};

const getScheduleStatusLabel = (schedule: WorkflowScheduleListItem): string => {
  if (!schedule.enabled || schedule.status === 'paused') return 'Paused';
  if (schedule.status === 'failed') return 'Failed';
  if (schedule.status === 'completed') return 'Completed';
  if (schedule.status === 'disabled') return 'Disabled';
  return 'Enabled';
};

const formatTimestamp = (value?: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const formatRelativeTimestamp = (value?: string | null): string => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return formatDistanceToNow(date, { addSuffix: true });
};

const defaultScheduleActions: WorkflowSchedulesActions = {
  createWorkflowScheduleAction: createWorkflowScheduleActionDefault,
  deleteWorkflowScheduleAction: deleteWorkflowScheduleActionDefault,
  getWorkflowScheduleAction: getWorkflowScheduleActionDefault,
  listWorkflowSchedulesAction: listWorkflowSchedulesActionDefault,
  pauseWorkflowScheduleAction: pauseWorkflowScheduleActionDefault,
  resumeWorkflowScheduleAction: resumeWorkflowScheduleActionDefault,
  updateWorkflowScheduleAction: updateWorkflowScheduleActionDefault,
};

export default function Schedules({
  scheduleActions = defaultScheduleActions
}: SchedulesProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const didUnmount = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([]);
  const [schedules, setSchedules] = useState<WorkflowScheduleListItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState(searchParams.get(SCHEDULE_SEARCH_PARAM) || '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get(SCHEDULE_STATUS_PARAM) as StatusFilter) || 'all'
  );
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>(
    (searchParams.get(SCHEDULE_TRIGGER_PARAM) as TriggerFilter) || 'all'
  );
  const [workflowFilter, setWorkflowFilter] = useState(searchParams.get(SCHEDULE_WORKFLOW_PARAM) || '');
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<WorkflowScheduleListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const updateUrlParams = (params: Record<string, string | null>) => {
    const nextParams = new URLSearchParams(searchParams?.toString() || '');
    Object.entries(params).forEach(([key, value]) => {
      if (value && value !== 'all' && value !== '') {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    });
    router.replace(`/msp/workflow-control?${nextParams.toString()}`, { scroll: false });
  };

  useEffect(() => {
    let cancelled = false;
    const loadWorkflowOptions = async () => {
      try {
        const result = await listWorkflowDefinitionsPagedAction({
          page: 1,
          pageSize: 200,
          status: 'all',
          trigger: 'all',
          sortBy: 'name',
          sortDirection: 'asc'
        });
        if (cancelled) return;
        setWorkflowOptions(((result as { items?: WorkflowOption[] } | null)?.items ?? []) as WorkflowOption[]);
      } catch (loadError) {
        if (cancelled) return;
        console.error('Failed to load workflow options for schedules list', loadError);
        setWorkflowOptions([]);
      }
    };

    void loadWorkflowOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    didUnmount.current = false;
    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await scheduleActions.listWorkflowSchedulesAction({
          workflowId: workflowFilter || undefined,
          status: statusFilter,
          triggerType: triggerFilter,
          search: searchTerm || undefined
        });
        if (didUnmount.current) return;
        setSchedules(((result as { items?: WorkflowScheduleListItem[] } | null)?.items ?? []) as WorkflowScheduleListItem[]);
      } catch (loadError) {
        console.error('Failed to load workflow schedules', loadError);
        if (!didUnmount.current) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load schedules.');
          setSchedules([]);
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
  }, [refreshKey, scheduleActions, searchTerm, statusFilter, triggerFilter, workflowFilter]);

  const handlePauseResume = async (schedule: WorkflowScheduleListItem) => {
    try {
      if (schedule.enabled && schedule.status !== 'paused') {
        await scheduleActions.pauseWorkflowScheduleAction({ scheduleId: schedule.id });
      } else {
        await scheduleActions.resumeWorkflowScheduleAction({ scheduleId: schedule.id });
      }
      setRefreshKey((value) => value + 1);
    } catch (actionError) {
      console.error('Failed to toggle workflow schedule', actionError);
      setError(actionError instanceof Error ? actionError.message : 'Failed to update schedule.');
    }
  };

  const workflowFilterOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: 'All workflows' },
      ...workflowOptions.map((workflow) => ({
        value: workflow.workflow_id,
        label: workflow.name
      }))
    ],
    [workflowOptions]
  );

  const statusOptions: SelectOption[] = [
    { value: 'all', label: 'All statuses' },
    { value: 'enabled', label: 'Enabled' },
    { value: 'paused', label: 'Paused' },
    { value: 'failed', label: 'Failed' },
    { value: 'completed', label: 'Completed' },
    { value: 'disabled', label: 'Disabled' }
  ];

  const triggerOptions: SelectOption[] = [
    { value: 'all', label: 'All triggers' },
    { value: 'schedule', label: 'One-time' },
    { value: 'recurring', label: 'Recurring' }
  ];

  const columns: ColumnDefinition<WorkflowScheduleListItem>[] = [
    {
      title: 'Schedule',
      dataIndex: 'name',
      render: (_value, record) => (
        <div className="flex flex-col gap-1">
          <div className="font-medium text-[rgb(var(--color-text-900))]">{record.name}</div>
          <div className="text-xs text-[rgb(var(--color-text-500))]">Workflow v{record.workflow_version}</div>
        </div>
      )
    },
    {
      title: 'Workflow',
      dataIndex: 'workflow_name',
      render: (_value, record) => (
        <span className="text-sm text-[rgb(var(--color-text-700))]">{record.workflow_name ?? 'Unknown workflow'}</span>
      )
    },
    {
      title: 'Trigger Type',
      dataIndex: 'trigger_type',
      render: (_value, record) => (
        <div className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-700))]">
          {record.trigger_type === 'schedule' ? (
            <CalendarClock className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
          ) : (
            <Clock3 className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
          )}
          <span>{record.trigger_type === 'schedule' ? 'One-time' : 'Recurring'}</span>
        </div>
      )
    },
    {
      title: 'Next Fire / Run At',
      dataIndex: 'next_fire_at',
      render: (_value, record) => (
        <div className="flex flex-col gap-1 text-sm text-[rgb(var(--color-text-700))]">
          <span>{formatTimestamp(record.next_fire_at ?? record.run_at)}</span>
          {record.trigger_type === 'recurring' && record.cron ? (
            <span className="text-xs text-[rgb(var(--color-text-500))]">
              {record.cron}{record.timezone ? ` · ${record.timezone}` : ''}
            </span>
          ) : null}
        </div>
      )
    },
    {
      title: 'Last Fire',
      dataIndex: 'last_fire_at',
      render: (_value, record) => (
        <span className="text-sm text-[rgb(var(--color-text-700))]">{formatRelativeTimestamp(record.last_fire_at)}</span>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (_value, record) => (
        <Badge variant={getScheduleStatusVariant(record)}>{getScheduleStatusLabel(record)}</Badge>
      )
    },
    {
      title: 'Last Error',
      dataIndex: 'last_error',
      render: (_value, record) => (
        <div className="max-w-[280px] text-sm text-[rgb(var(--color-text-600))]">
          {record.last_error ? (
            <span className="line-clamp-2">{record.last_error}</span>
          ) : (
            <span className="text-[rgb(var(--color-text-400))]">—</span>
          )}
        </div>
      )
    },
    {
      title: 'Actions',
      dataIndex: 'id',
      width: '72px',
      render: (_value, record) => (
        <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="rounded-md p-1.5 transition-colors hover:bg-[rgb(var(--color-border-100))]"
                aria-label={`Schedule actions for ${record.name}`}
              >
                <MoreVertical className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-50 min-w-[170px] rounded-lg border border-[rgb(var(--color-border-200))] bg-white py-1 shadow-lg"
                sideOffset={5}
                align="end"
              >
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] outline-none hover:bg-[rgb(var(--color-border-50))]"
                  onSelect={() => {
                    setDialogMode('edit');
                    setActiveScheduleId(record.id);
                    setIsDialogOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] outline-none hover:bg-[rgb(var(--color-border-50))]"
                  onSelect={() => void handlePauseResume(record)}
                >
                  {record.enabled && record.status !== 'paused' ? (
                    <>
                      <Pause className="h-4 w-4" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Resume
                    </>
                  )}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-[rgb(var(--color-border-200))]" />
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-destructive))] outline-none hover:bg-destructive/10"
                  onSelect={() => {
                    setScheduleToDelete(record);
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )
    }
  ];

  const deleteValidation = useMemo<DeletionValidationResult | null>(() => (
    scheduleToDelete
      ? {
        canDelete: true,
        dependencies: [],
        alternatives: []
      }
      : null
  ), [scheduleToDelete]);

  const openCreateDialog = () => {
    setDialogMode('create');
    setActiveScheduleId(null);
    setIsDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!scheduleToDelete) return;
    setIsDeleting(true);
    try {
      await scheduleActions.deleteWorkflowScheduleAction({ scheduleId: scheduleToDelete.id });
      setIsDeleteDialogOpen(false);
      setScheduleToDelete(null);
      setRefreshKey((value) => value + 1);
    } catch (deleteError) {
      console.error('Failed to delete workflow schedule', deleteError);
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete schedule.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <ReflectionContainer id="workflow-schedules-loading" label="Workflow Schedules Loading">
        <div className="py-8 text-sm text-[rgb(var(--color-text-500))]">Loading schedules…</div>
      </ReflectionContainer>
    );
  }

  return (
    <ReflectionContainer id="workflow-schedules" label="Workflow Schedules" className="h-full min-h-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">Schedules</h2>
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              Manage reusable workflow schedules and their saved payloads.
            </p>
          </div>
          <Button id="create-schedule-btn" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            New Schedule
          </Button>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px_180px]">
          <SearchInput
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              updateUrlParams({ [SCHEDULE_SEARCH_PARAM]: event.target.value });
            }}
            placeholder="Search schedules..."
            className="w-full"
          />
          <CustomSelect
            id="schedules-filter-workflow"
            value={workflowFilter || 'all'}
            onValueChange={(value) => {
              const nextValue = value === 'all' ? '' : value;
              setWorkflowFilter(nextValue);
              updateUrlParams({ [SCHEDULE_WORKFLOW_PARAM]: nextValue });
            }}
            options={workflowFilterOptions}
          />
          <CustomSelect
            id="schedules-filter-trigger"
            value={triggerFilter}
            onValueChange={(value) => {
              setTriggerFilter(value as TriggerFilter);
              updateUrlParams({ [SCHEDULE_TRIGGER_PARAM]: value });
            }}
            options={triggerOptions}
          />
          <CustomSelect
            id="schedules-filter-status"
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value as StatusFilter);
              updateUrlParams({ [SCHEDULE_STATUS_PARAM]: value });
            }}
            options={statusOptions}
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {schedules.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-8 text-center">
            <div className="max-w-md space-y-2">
              <div className="text-lg font-semibold text-[rgb(var(--color-text-900))]">No schedules found</div>
              <div className="text-sm text-[rgb(var(--color-text-500))]">
                Create a one-time or recurring schedule to run a published workflow with saved input data.
              </div>
            </div>
          </div>
        ) : (
          <DataTable
            id="workflow-schedules-table"
            data={schedules}
            columns={columns}
            pagination={false}
          />
        )}
      </div>

      <WorkflowScheduleDialog
        isOpen={isDialogOpen}
        mode={dialogMode}
        scheduleId={activeScheduleId}
        initialWorkflowId={workflowFilter || undefined}
        scheduleActions={scheduleActions}
        onClose={() => setIsDialogOpen(false)}
        onSaved={() => setRefreshKey((value) => value + 1)}
      />

      <DeleteEntityDialog
        id="workflow-schedule-delete"
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setScheduleToDelete(null);
        }}
        onConfirmDelete={() => void handleDeleteConfirm()}
        entityName={scheduleToDelete?.name ?? 'schedule'}
        validationResult={deleteValidation}
        isValidating={false}
        isDeleting={isDeleting}
      />
    </ReflectionContainer>
  );
}
