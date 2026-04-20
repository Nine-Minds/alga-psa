'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarClock, Clock3, MoreVertical, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition, DeletionValidationResult } from '@alga-psa/types';
import type { WorkflowScheduleStateRecord } from '@alga-psa/workflows/persistence';
import {
  createWorkflowScheduleAction as createWorkflowScheduleActionDefault,
  deleteWorkflowScheduleAction as deleteWorkflowScheduleActionDefault,
  getWorkflowScheduleAction as getWorkflowScheduleActionDefault,
  listWorkflowScheduleBusinessHoursAction as listWorkflowScheduleBusinessHoursActionDefault,
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
  next_eligible_fire_at?: string | null;
  effective_business_hours_schedule_id?: string | null;
  effective_business_hours_schedule_name?: string | null;
  business_hours_schedule_source?: 'override' | 'tenant_default' | null;
  calendar_resolution_error?: string | null;
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

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const getScheduleStatusLabel = (schedule: WorkflowScheduleListItem, t: TranslateFn): string => {
  if (!schedule.enabled || schedule.status === 'paused') {
    return t('schedules.status.paused', { defaultValue: 'Paused' });
  }
  if (schedule.status === 'failed') {
    return t('schedules.status.failed', { defaultValue: 'Failed' });
  }
  if (schedule.status === 'completed') {
    return t('schedules.status.completed', { defaultValue: 'Completed' });
  }
  if (schedule.status === 'disabled') {
    return t('schedules.status.disabled', { defaultValue: 'Disabled' });
  }
  return t('schedules.status.enabled', { defaultValue: 'Enabled' });
};

const formatTimestamp = (
  value: string | null | undefined,
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string,
  t: TranslateFn
): string => {
  if (!value) return t('schedules.common.emptyValue', { defaultValue: '—' });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('schedules.common.emptyValue', { defaultValue: '—' });
  }
  return formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
};

const formatRelativeTimestamp = (
  value: string | null | undefined,
  formatRelativeTime: (date: Date | string) => string,
  t: TranslateFn
): string => {
  if (!value) return t('schedules.states.never', { defaultValue: 'Never' });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('schedules.states.never', { defaultValue: 'Never' });
  }
  return formatRelativeTime(date);
};

const toDayFilterLabel = (value: string | null | undefined, t: TranslateFn): string => {
  if (value === 'business') {
    return t('schedules.dayType.business', { defaultValue: 'Business days' });
  }
  if (value === 'non_business') {
    return t('schedules.dayType.nonBusiness', { defaultValue: 'Non-business days' });
  }
  return t('schedules.dayType.any', { defaultValue: 'Any day' });
};

const getNextFireDisplayText = (
  schedule: WorkflowScheduleListItem,
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string,
  t: TranslateFn
): string => {
  if (schedule.trigger_type === 'recurring' && schedule.day_type_filter !== 'any') {
    if (schedule.next_eligible_fire_at) {
      return formatTimestamp(schedule.next_eligible_fire_at, formatDate, t);
    }
    if (schedule.calendar_resolution_error) {
      return t('schedules.states.calendarMisconfigured', { defaultValue: 'Calendar misconfigured' });
    }
    return t('schedules.states.noEligibleUpcomingRun', { defaultValue: 'No eligible upcoming run' });
  }

  return formatTimestamp(schedule.next_fire_at ?? schedule.run_at, formatDate, t);
};

const defaultScheduleActions: WorkflowSchedulesActions = {
  createWorkflowScheduleAction: createWorkflowScheduleActionDefault,
  deleteWorkflowScheduleAction: deleteWorkflowScheduleActionDefault,
  getWorkflowScheduleAction: getWorkflowScheduleActionDefault,
  listWorkflowScheduleBusinessHoursAction: listWorkflowScheduleBusinessHoursActionDefault,
  listWorkflowSchedulesAction: listWorkflowSchedulesActionDefault,
  pauseWorkflowScheduleAction: pauseWorkflowScheduleActionDefault,
  resumeWorkflowScheduleAction: resumeWorkflowScheduleActionDefault,
  updateWorkflowScheduleAction: updateWorkflowScheduleActionDefault,
};

export default function Schedules({
  scheduleActions = defaultScheduleActions
}: SchedulesProps) {
  const { t } = useTranslation('msp/workflows');
  const { formatDate, formatRelativeTime } = useFormatters();
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
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
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
          setError(loadError instanceof Error ? loadError.message : t('schedules.errors.loadFailed', {
            defaultValue: 'Failed to load schedules.',
          }));
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
  }, [refreshKey, scheduleActions, searchTerm, statusFilter, t, triggerFilter, workflowFilter]);

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
      setError(actionError instanceof Error ? actionError.message : t('schedules.errors.updateFailed', {
        defaultValue: 'Failed to update schedule.',
      }));
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, triggerFilter, workflowFilter]);

  const pagedSchedules = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return schedules.slice(start, start + pageSize);
  }, [currentPage, schedules]);

  const workflowFilterOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: t('schedules.filters.allWorkflows', { defaultValue: 'All workflows' }) },
      ...workflowOptions.map((workflow) => ({
        value: workflow.workflow_id,
        label: workflow.name
      }))
    ],
    [t, workflowOptions]
  );

  const statusOptions: SelectOption[] = [
    { value: 'all', label: t('schedules.filters.allStatuses', { defaultValue: 'All statuses' }) },
    { value: 'enabled', label: t('schedules.status.enabled', { defaultValue: 'Enabled' }) },
    { value: 'paused', label: t('schedules.status.paused', { defaultValue: 'Paused' }) },
    { value: 'failed', label: t('schedules.status.failed', { defaultValue: 'Failed' }) },
    { value: 'completed', label: t('schedules.status.completed', { defaultValue: 'Completed' }) },
    { value: 'disabled', label: t('schedules.status.disabled', { defaultValue: 'Disabled' }) }
  ];

  const triggerOptions: SelectOption[] = [
    { value: 'all', label: t('schedules.filters.allTriggers', { defaultValue: 'All triggers' }) },
    { value: 'schedule', label: t('schedules.triggerType.schedule', { defaultValue: 'One-time' }) },
    { value: 'recurring', label: t('schedules.triggerType.recurring', { defaultValue: 'Recurring' }) }
  ];

  const columns: ColumnDefinition<WorkflowScheduleListItem>[] = [
    {
      title: t('schedules.table.columns.schedule', { defaultValue: 'Schedule' }),
      dataIndex: 'name',
      render: (_value, record) => (
        <div className="flex flex-col gap-1">
          <div className="font-medium text-[rgb(var(--color-text-900))]">{record.name}</div>
          <div className="text-xs text-[rgb(var(--color-text-500))]">
            {t('schedules.table.workflowVersion', {
              defaultValue: 'Workflow v{{version}}',
              version: record.workflow_version,
            })}
          </div>
        </div>
      )
    },
    {
      title: t('schedules.table.columns.workflow', { defaultValue: 'Workflow' }),
      dataIndex: 'workflow_name',
      render: (_value, record) => (
        <span className="text-sm text-[rgb(var(--color-text-700))]">
          {record.workflow_name ?? t('schedules.states.unknownWorkflow', { defaultValue: 'Unknown workflow' })}
        </span>
      )
    },
    {
      title: t('schedules.table.columns.triggerType', { defaultValue: 'Trigger Type' }),
      dataIndex: 'trigger_type',
      render: (_value, record) => (
        <div className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-700))]">
          {record.trigger_type === 'schedule' ? (
            <CalendarClock className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
          ) : (
            <Clock3 className="h-4 w-4 text-[rgb(var(--color-primary-500))]" />
          )}
          <span>
            {record.trigger_type === 'schedule'
              ? t('schedules.triggerType.schedule', { defaultValue: 'One-time' })
              : t('schedules.triggerType.recurring', { defaultValue: 'Recurring' })}
          </span>
        </div>
      )
    },
    {
      title: t('schedules.table.columns.nextFire', { defaultValue: 'Next Fire / Run At' }),
      dataIndex: 'next_fire_at',
      render: (_value, record) => (
        <div className="flex flex-col gap-1 text-sm text-[rgb(var(--color-text-700))]">
          <span>{getNextFireDisplayText(record, formatDate, t)}</span>
          {record.trigger_type === 'recurring' && record.cron ? (
            <span className="text-xs text-[rgb(var(--color-text-500))]">
              {record.cron}{record.timezone ? ` · ${record.timezone}` : ''}
            </span>
          ) : null}
          {record.trigger_type === 'recurring' ? (
            <span className="text-xs text-[rgb(var(--color-text-500))]">
              {toDayFilterLabel(record.day_type_filter, t)}
            </span>
          ) : null}
        </div>
      )
    },
    {
      title: t('schedules.table.columns.lastFire', { defaultValue: 'Last Fire' }),
      dataIndex: 'last_fire_at',
      render: (_value, record) => (
        <span className="text-sm text-[rgb(var(--color-text-700))]">
          {formatRelativeTimestamp(record.last_fire_at, formatRelativeTime, t)}
        </span>
      )
    },
    {
      title: t('schedules.table.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (_value, record) => (
        <Badge variant={getScheduleStatusVariant(record)}>{getScheduleStatusLabel(record, t)}</Badge>
      )
    },
    {
      title: t('schedules.table.columns.lastError', { defaultValue: 'Last Error' }),
      dataIndex: 'last_error',
      render: (_value, record) => (
        <div className="max-w-[280px] text-sm text-[rgb(var(--color-text-600))]">
          {record.last_error ? (
            <span className="line-clamp-2">{record.last_error}</span>
          ) : (
            <span className="text-[rgb(var(--color-text-400))]">
              {t('schedules.common.emptyValue', { defaultValue: '—' })}
            </span>
          )}
        </div>
      )
    },
    {
      title: t('schedules.table.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'id',
      width: '72px',
      render: (_value, record) => (
        <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="rounded-md p-1.5 transition-colors hover:bg-[rgb(var(--color-border-100))]"
                aria-label={t('schedules.actions.rowMenu', {
                  defaultValue: 'Schedule actions for {{name}}',
                  name: record.name,
                })}
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
                    openEditDialog(record.id);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  {t('schedules.actions.edit', { defaultValue: 'Edit' })}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[rgb(var(--color-text-700))] outline-none hover:bg-[rgb(var(--color-border-50))]"
                  onSelect={() => void handlePauseResume(record)}
                >
                  {record.enabled && record.status !== 'paused' ? (
                    <>
                      <Pause className="h-4 w-4" />
                      {t('schedules.actions.pause', { defaultValue: 'Pause' })}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      {t('schedules.actions.resume', { defaultValue: 'Resume' })}
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
                  {t('schedules.actions.delete', { defaultValue: 'Delete' })}
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

  const openEditDialog = (scheduleId: string) => {
    setDialogMode('edit');
    setActiveScheduleId(scheduleId);
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
      setError(deleteError instanceof Error ? deleteError.message : t('schedules.errors.deleteFailed', {
        defaultValue: 'Failed to delete schedule.',
      }));
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <ReflectionContainer
        id="workflow-schedules-loading"
        label={t('schedules.states.loadingReflection', { defaultValue: 'Workflow Schedules Loading' })}
      >
        <div className="py-8 text-sm text-[rgb(var(--color-text-500))]">
          {t('schedules.states.loading', { defaultValue: 'Loading schedules…' })}
        </div>
      </ReflectionContainer>
    );
  }

  return (
    <ReflectionContainer
      id="workflow-schedules"
      label={t('schedules.heading.reflectionLabel', { defaultValue: 'Workflow Schedules' })}
      className="h-full min-h-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
              {t('schedules.heading.title', { defaultValue: 'Schedules' })}
            </h2>
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('schedules.heading.description', {
                defaultValue: 'Manage reusable workflow schedules and their saved payloads.',
              })}
            </p>
          </div>
          <Button id="create-schedule-btn" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            {t('schedules.actions.new', { defaultValue: 'New Schedule' })}
          </Button>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px_180px]">
          <SearchInput
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              updateUrlParams({ [SCHEDULE_SEARCH_PARAM]: event.target.value });
            }}
            placeholder={t('schedules.filters.searchPlaceholder', { defaultValue: 'Search schedules...' })}
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
              <div className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                {t('schedules.states.empty', { defaultValue: 'No schedules found' })}
              </div>
              <div className="text-sm text-[rgb(var(--color-text-500))]">
                {t('schedules.states.emptyDescription', {
                  defaultValue: 'Create a one-time or recurring schedule to run a published workflow with saved input data.',
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[rgb(var(--color-border-200))] bg-white">
            <div className="h-full min-h-0 overflow-y-auto">
              <DataTable
                id="workflow-schedules-table"
                data={pagedSchedules}
                columns={columns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                totalItems={schedules.length}
                onRowClick={(record) => openEditDialog(record.id)}
              />
            </div>
          </div>
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
        entityName={scheduleToDelete?.name ?? t('schedules.common.entityName', { defaultValue: 'schedule' })}
        validationResult={deleteValidation}
        isValidating={false}
        isDeleting={isDeleting}
      />
    </ReflectionContainer>
  );
}
