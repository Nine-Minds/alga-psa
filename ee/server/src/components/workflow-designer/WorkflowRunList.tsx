'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import Drawer from '@alga-psa/ui/components/Drawer';
import WorkflowRunDialog from './WorkflowRunDialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { toast } from 'react-hot-toast';
import {
  cancelWorkflowRunAction,
  exportWorkflowRunsAction,
  listWorkflowRunSummaryAction,
  listWorkflowRunsAction,
  resumeWorkflowRunAction
} from '@alga-psa/workflows/actions';
import {
  useFormatWorkflowRunStatus,
  useWorkflowRunSortOptions,
  useWorkflowRunStatusOptions,
} from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import WorkflowRunDetails from './WorkflowRunDetails';
import {
  getWorkflowScheduleStatusBadgeClass,
  isTimeTriggeredRun
} from './workflowRunTriggerPresentation';
import {
  useFormatWorkflowRunTrigger,
  useFormatWorkflowScheduleStatus,
} from './useWorkflowRunTriggerPresentation';

type WorkflowDefinitionSummary = {
  workflow_id: string;
  name: string;
  trigger?: Record<string, unknown> | null;
  schedule_state?: WorkflowScheduleStateSummary | null;
  payload_schema_ref?: string | null;
  published_version?: number | null;
  validation_status?: string | null;
  is_paused?: boolean;
  concurrency_limit?: number | null;
  is_system?: boolean;
};

type WorkflowScheduleStateSummary = {
  status?: 'scheduled' | 'paused' | 'disabled' | 'completed' | 'failed' | null;
  enabled?: boolean;
};

type WorkflowRunListItem = {
  run_id: string;
  workflow_id: string;
  workflow_name?: string | null;
  workflow_version: number;
  tenant_id?: string | null;
  status: string;
  trigger_type?: 'event' | 'schedule' | 'recurring' | null;
  source_payload_schema_ref?: string | null;
  trigger_mapping_applied?: boolean | null;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
};

type WorkflowRunListResponse = {
  runs: WorkflowRunListItem[];
  nextCursor: number | null;
};

type WorkflowRunSummaryResponse = {
  total: number;
  byStatus: Record<string, number>;
};

type WorkflowRunFilters = {
  status: string;
  workflowId: string;
  workflowVersion: string;
  search: string;
  from: string;
  to: string;
  sort: string;
};

const STATUS_STYLES: Record<string, string> = {
  RUNNING: 'bg-info/15 text-info-foreground',
  WAITING: 'bg-warning/15 text-warning-foreground',
  SUCCEEDED: 'bg-success/15 text-success',
  FAILED: 'bg-destructive/15 text-destructive',
  CANCELED: 'bg-muted text-muted-foreground'
};

const DEFAULT_FILTERS: WorkflowRunFilters = {
  status: 'all',
  workflowId: '',
  workflowVersion: '',
  search: '',
  from: '',
  to: '',
  sort: 'started_at:desc'
};

const useFormatDateTime = () => {
  const { formatDate } = useFormatters();
  return useCallback(
    (value?: string | null) => {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
    },
    [formatDate]
  );
};

const formatDuration = (start?: string | null, end?: string | null) => {
  if (!start || !end) return '—';
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return '—';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

const parseDateInputAsUtc = (value?: string): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const toExclusiveUpperBoundIso = (value?: string): string | undefined => {
  const date = parseDateInputAsUtc(value);
  if (!date) return undefined;
  const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  return nextDay.toISOString();
};

const toInclusiveLowerBoundIso = (value?: string): string | undefined => {
  const date = parseDateInputAsUtc(value);
  return date ? date.toISOString() : undefined;
};

const buildRunDateBounds = (filters: WorkflowRunFilters): { from?: string; to?: string } => ({
  from: toInclusiveLowerBoundIso(filters.from),
  to: toExclusiveUpperBoundIso(filters.to)
});


interface WorkflowRunListProps {
  definitions: WorkflowDefinitionSummary[];
  workflowStatusById?: Map<string, string>;
  workflowRunCountById?: Map<string, number>;
  isActive: boolean;
  canAdmin?: boolean;
  canManage?: boolean;
}

const WorkflowRunList: React.FC<WorkflowRunListProps> = ({
  definitions,
  workflowStatusById,
  workflowRunCountById,
  isActive,
  canAdmin = false,
  canManage = false
}) => {
  const { t } = useTranslation('msp/workflows');
  const formatWorkflowRunStatus = useFormatWorkflowRunStatus();
  const formatWorkflowRunTrigger = useFormatWorkflowRunTrigger();
  const formatWorkflowScheduleStatus = useFormatWorkflowScheduleStatus();
  const formatDateTime = useFormatDateTime();
  const workflowRunStatusOptions = useWorkflowRunStatusOptions();
  const workflowRunSortOptions = useWorkflowRunSortOptions();
  const [filters, setFilters] = useState<WorkflowRunFilters>(DEFAULT_FILTERS);
  const [runs, setRuns] = useState<WorkflowRunListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'resume' | 'cancel' | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);
  const handleRunDetailsClose = useCallback(() => setSelectedRunId(null), []);
  const [summary, setSummary] = useState<WorkflowRunSummaryResponse | null>(null);
  const limit = 25;
  const statusOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: 'all',
        label: t('filters.allStatuses', { defaultValue: 'All statuses' }),
      },
      ...workflowRunStatusOptions,
    ],
    [t, workflowRunStatusOptions]
  );

  const workflowOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: '',
        label: t('runList.filters.allWorkflows', { defaultValue: 'All workflows' }),
      },
      ...definitions.map((definition) => ({
        value: definition.workflow_id,
        label: definition.name,
      })),
    ],
    [definitions, t]
  );
  const workflowNameMap = useMemo(
    () => new Map(definitions.map((definition) => [definition.workflow_id, definition.name])),
    [definitions]
  );
  const workflowTriggerMap = useMemo(() => {
    const map = new Map<string, string | null>();
    definitions.forEach((definition) => {
      const trigger = definition.trigger ?? null;
      if (!trigger) {
        map.set(definition.workflow_id, null);
        return;
      }
      map.set(
        definition.workflow_id,
        formatWorkflowRunTrigger(
          typeof (trigger as any)?.type === 'string' ? (trigger as any).type : null,
          typeof (trigger as any)?.eventName === 'string' ? (trigger as any).eventName : null
        )
      );
    });
    return map;
  }, [definitions, formatWorkflowRunTrigger]);
  const workflowScheduleStateMap = useMemo(
    () => new Map(definitions.map((definition) => [definition.workflow_id, definition.schedule_state ?? null])),
    [definitions]
  );

  const activeDefinition = useMemo(
    () => definitions.find((definition) => definition.workflow_id === filters.workflowId) ?? null,
    [definitions, filters.workflowId]
  );

  const selectedRuns = useMemo(
    () => runs.filter((run) => selectedRunIds.has(run.run_id)),
    [runs, selectedRunIds]
  );
  const selectedRunIndex = useMemo(
    () => runs.findIndex((run) => run.run_id === selectedRunId),
    [runs, selectedRunId]
  );
  const selectedRun = selectedRunIndex >= 0 ? runs[selectedRunIndex] : null;
  const canSelectPreviousRun = selectedRunIndex > 0;
  const canSelectNextRun = selectedRunIndex >= 0 && selectedRunIndex < runs.length - 1;
  const handleSelectAdjacentRun = useCallback((direction: -1 | 1) => {
    if (selectedRunIndex < 0) return;
    const nextRun = runs[selectedRunIndex + direction];
    if (nextRun) {
      setSelectedRunId(nextRun.run_id);
    }
  }, [runs, selectedRunIndex]);
  const showSelection = canAdmin;

  const showTenantColumn = useMemo(() => {
    const tenants = new Set(runs.map((run) => run.tenant_id).filter(Boolean));
    return tenants.size > 1;
  }, [runs]);

  const fetchRuns = useCallback(
    async (cursor: number, append = false, overrideFilters?: WorkflowRunFilters) => {
      const activeFilters = overrideFilters ?? filters;
      const { from, to } = buildRunDateBounds(activeFilters);
      setIsLoading(true);
      try {
        const data = (await listWorkflowRunsAction({
          status: activeFilters.status !== 'all' ? [activeFilters.status as any] : undefined,
          workflowId: activeFilters.workflowId || undefined,
          version: activeFilters.workflowVersion || undefined,
          search: activeFilters.search || undefined,
          from,
          to,
          limit,
          cursor,
          sort: activeFilters.sort as any
        })) as WorkflowRunListResponse;
        setRuns((prev) => (append ? [...prev, ...data.runs] : data.runs));
        setNextCursor(data.nextCursor ?? null);
        if (!append) {
          setSelectedRunIds(new Set());
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t('runList.toasts.loadRunsFailed', { defaultValue: 'Failed to load workflow runs' })
        );
      } finally {
        setIsLoading(false);
      }
    },
    [filters, t]
  );

  const fetchSummary = useCallback(
    async (overrideFilters?: WorkflowRunFilters) => {
      const activeFilters = overrideFilters ?? filters;
      const { from, to } = buildRunDateBounds(activeFilters);
      try {
        const data = (await listWorkflowRunSummaryAction({
          workflowId: activeFilters.workflowId || undefined,
          version: activeFilters.workflowVersion || undefined,
          from,
          to
        })) as WorkflowRunSummaryResponse;
        setSummary(data);
      } catch (error) {
        setSummary(null);
      }
    },
    [filters]
  );

  const runningWorkflowButtons = useMemo(() => {
    if (!workflowStatusById) return [];
    const isActiveStatus = (status: string | undefined) => status === 'RUNNING' || status === 'WAITING';
    return definitions
      .map((definition) => {
        const status = workflowStatusById.get(definition.workflow_id) ?? undefined;
        if (!isActiveStatus(status)) return null;
        return {
          workflowId: definition.workflow_id,
          name: definition.name,
          status,
          runCount: workflowRunCountById?.get(definition.workflow_id) ?? null
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((a, b) => {
        const aSort = a.status === 'RUNNING' ? 0 : 1;
        const bSort = b.status === 'RUNNING' ? 0 : 1;
        if (aSort !== bSort) return aSort - bSort;
        return a.name.localeCompare(b.name);
      });
  }, [definitions, workflowRunCountById, workflowStatusById]);

  useEffect(() => {
    if (isActive) {
      fetchRuns(0, false);
      fetchSummary();
    }
  }, [fetchRuns, fetchSummary, isActive]);

  useEffect(() => {
    setBulkReason('');
  }, [bulkAction]);


  const handleApplyFilters = () => {
    fetchRuns(0, false);
    fetchSummary();
  };

  const handleViewLatestRun = async () => {
    if (!activeDefinition) {
      toast.error(
        t('runList.toasts.selectWorkflowForLatestRun', {
          defaultValue: 'Select a workflow to view its latest run.',
        })
      );
      return;
    }
    try {
      const result = (await listWorkflowRunsAction({
        workflowId: activeDefinition.workflow_id,
        limit: 1,
        cursor: 0,
        sort: 'started_at:desc'
      })) as WorkflowRunListResponse;
      const latest = result.runs?.[0];
      if (!latest) {
        toast.error(
          t('runList.toasts.noRunsFoundForWorkflow', {
            defaultValue: 'No runs found for that workflow.',
          })
        );
        return;
      }
      window.location.assign(`/msp/workflows/runs/${latest.run_id}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('runList.toasts.loadLatestRunFailed', { defaultValue: 'Failed to load latest run' })
      );
    }
  };

  const openRunDialog = () => {
    if (!activeDefinition) {
      toast.error(
        t('runList.toasts.selectWorkflowToRun', {
          defaultValue: 'Select a workflow to run.',
        })
      );
      return;
    }
    setIsRunDialogOpen(true);
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    fetchRuns(0, false, DEFAULT_FILTERS);
    fetchSummary(DEFAULT_FILTERS);
  };

  const applyWorkflowFilter = (workflowId: string) => {
    const nextFilters: WorkflowRunFilters = {
      ...filters,
      workflowId,
      workflowVersion: ''
    };
    setFilters(nextFilters);
    fetchRuns(0, false, nextFilters);
    fetchSummary(nextFilters);
  };

  const handleExport = async () => {
    const { from, to } = buildRunDateBounds(filters);
    try {
      const result = await exportWorkflowRunsAction({
        status: filters.status !== 'all' ? [filters.status as any] : undefined,
        workflowId: filters.workflowId || undefined,
        version: filters.workflowVersion || undefined,
        search: filters.search || undefined,
        from,
        to,
        sort: filters.sort as any,
        limit: 1000,
        cursor: 0
      });
      const blob = new Blob([result.body], { type: result.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success(t('runList.toasts.exportReady', { defaultValue: 'Run export ready' }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('runList.toasts.exportFailed', { defaultValue: 'Failed to export runs' })
      );
    }
  };

  const applyQuickRange = (hours: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const formatDate = (date: Date) => date.toISOString().slice(0, 10);
    const nextFilters = {
      ...filters,
      from: formatDate(from),
      to: formatDate(now)
    };
    setFilters(nextFilters);
    fetchRuns(0, false, nextFilters);
    fetchSummary(nextFilters);
  };

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedRunIds(new Set());
      return;
    }
    setSelectedRunIds(new Set(runs.map((run) => run.run_id)));
  };

  const toggleRunSelection = (runId: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const performBulkAction = async (action: 'resume' | 'cancel') => {
    if (selectedRuns.length === 0) {
      toast.error(
        t('runList.toasts.selectRunsForBulkAction', {
          defaultValue: 'Select runs to perform this action.',
        })
      );
      setBulkAction(null);
      return;
    }
    if (bulkReason.trim().length < 3) {
      toast.error(
        t('runList.toasts.bulkReasonTooShort', {
          defaultValue: 'Reason must be at least 3 characters.',
        })
      );
      return;
    }

    const eligible = selectedRuns.filter((run) =>
      action === 'resume' ? run.status === 'WAITING' : !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(run.status)
    );
    const skipped = selectedRuns.length - eligible.length;

    if (eligible.length === 0) {
      toast.error(
        t('runList.toasts.noEligibleRuns', {
          defaultValue: 'No selected runs are eligible for that action.',
        })
      );
      setBulkAction(null);
      return;
    }

    try {
      const responses = await Promise.all(
        eligible.map((run) =>
          action === 'resume'
            ? resumeWorkflowRunAction({ runId: run.run_id, reason: bulkReason.trim(), source: 'ui' })
            : cancelWorkflowRunAction({ runId: run.run_id, reason: bulkReason.trim(), source: 'ui' })
        )
      );
      const failed = responses.filter((response: any) => !response?.ok).length;
      if (failed > 0) {
        toast.error(
          t(
            action === 'resume'
              ? 'runList.toasts.bulkResumeFailedCount'
              : 'runList.toasts.bulkCancelFailedCount',
            {
              defaultValue:
                action === 'resume'
                  ? 'Failed to resume {{count}} run(s).'
                  : 'Failed to cancel {{count}} run(s).',
              count: failed,
            }
          )
        );
      } else {
        toast.success(
          t(
            action === 'resume'
              ? 'runList.toasts.bulkResumeSuccessCount'
              : 'runList.toasts.bulkCancelSuccessCount',
            {
              defaultValue:
                action === 'resume'
                  ? 'Resumed {{count}} run(s).'
                  : 'Canceled {{count}} run(s).',
              count: eligible.length,
            }
          )
        );
      }
      if (skipped > 0) {
        toast(
          t('runList.toasts.bulkSkippedIneligibleCount', {
            defaultValue: 'Skipped {{count}} ineligible run(s).',
            count: skipped,
          }),
          { icon: '⚠️' }
        );
      }
      setBulkAction(null);
      setBulkReason('');
      setSelectedRunIds(new Set());
      fetchRuns(0, false);
      fetchSummary();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('runList.toasts.bulkActionFailed', { defaultValue: 'Bulk action failed' })
      );
      setBulkAction(null);
    }
  };

  const allSelected = runs.length > 0 && selectedRunIds.size === runs.length;
  const someSelected = selectedRunIds.size > 0 && selectedRunIds.size < runs.length;
  const columnCount = (showSelection ? 10 : 9) + (showTenantColumn ? 1 : 0);
  const canRunSelected = !!activeDefinition?.workflow_id
    && canManage
    && !!activeDefinition.published_version
    && !activeDefinition.is_paused
    && (!activeDefinition.is_system || canAdmin);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-gray-50">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button id="workflow-runs-last-24h" variant="outline" size="sm" onClick={() => applyQuickRange(24)}>
              {t('runList.quickRanges.last24h', { defaultValue: 'Last 24h' })}
            </Button>
            <Button id="workflow-runs-last-7d" variant="outline" size="sm" onClick={() => applyQuickRange(168)}>
              {t('runList.quickRanges.last7d', { defaultValue: 'Last 7d' })}
            </Button>
            {summary && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>{t('runList.summary.total', { defaultValue: 'Total' })}: {summary.total}</span>
                {Object.entries(summary.byStatus).map(([status, count]) => (
                  <Badge key={status} className={STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}>
                    {formatWorkflowRunStatus(status)}: {count}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {isActive && runningWorkflowButtons.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-xs text-gray-500 shrink-0">
                {t('runList.summary.activeWorkflows', { defaultValue: 'Active workflows' })}
              </span>
              <Button
                id="workflow-runs-active-all"
                variant={filters.workflowId === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyWorkflowFilter('')}
              >
                {t('runList.filters.all', { defaultValue: 'All' })}
              </Button>
              {runningWorkflowButtons.map((workflow) => (
                <Button
                  key={workflow.workflowId}
                  id={`workflow-runs-active-${workflow.workflowId}`}
                  variant={filters.workflowId === workflow.workflowId ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => applyWorkflowFilter(workflow.workflowId)}
                  className="whitespace-nowrap"
                >
                  <span className="flex items-center gap-2">
                    <Badge className={STATUS_STYLES[workflow.status] ?? 'bg-gray-100 text-gray-600'}>
                      {formatWorkflowRunStatus(workflow.status)}
                    </Badge>
                    <span>{workflow.name}</span>
                    {workflow.runCount != null && (
                      <Badge variant="info">
                        {t('runList.summary.runCount', {
                          defaultValue: '{{count}} runs',
                          count: workflow.runCount,
                        })}
                      </Badge>
                    )}
                  </span>
                </Button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              id="workflow-runs-search"
              label={t('runList.filters.searchLabel', { defaultValue: 'Run ID or correlation key' })}
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder={t('runList.filters.searchPlaceholder', {
                defaultValue: 'Search by run id or correlation key',
              })}
            />
            <CustomSelect
              id="workflow-runs-status"
              label={t('runList.filters.statusLabel', { defaultValue: 'Status' })}
              options={statusOptions}
              value={filters.status}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            />
            <CustomSelect
              id="workflow-runs-workflow"
              label={t('runList.filters.workflowLabel', { defaultValue: 'Workflow' })}
              options={workflowOptions}
              value={filters.workflowId}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, workflowId: value }))}
            />
            <Input
              id="workflow-runs-version"
              label={t('runList.filters.versionLabel', { defaultValue: 'Workflow version' })}
              type="number"
              value={filters.workflowVersion}
              onChange={(event) => setFilters((prev) => ({ ...prev, workflowVersion: event.target.value }))}
              onWheel={(event) => {
                if (document.activeElement === event.currentTarget) {
                  event.currentTarget.blur();
                }
              }}
              placeholder={t('runList.filters.versionPlaceholder', { defaultValue: 'Any version' })}
            />
            <Input
              id="workflow-runs-from"
              label={t('runList.filters.fromLabel', { defaultValue: 'From' })}
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
            <Input
              id="workflow-runs-to"
              label={t('runList.filters.toLabel', { defaultValue: 'To' })}
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
            <CustomSelect
              id="workflow-runs-sort"
              label={t('runList.filters.sortLabel', { defaultValue: 'Sort' })}
              options={workflowRunSortOptions}
              value={filters.sort}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, sort: value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button id="workflow-runs-apply" onClick={handleApplyFilters} disabled={isLoading}>
              {t('runList.actions.applyFilters', { defaultValue: 'Apply filters' })}
            </Button>
            <Button id="workflow-runs-reset" variant="outline" onClick={handleResetFilters} disabled={isLoading}>
              {t('runList.actions.reset', { defaultValue: 'Reset' })}
            </Button>
            <Button
              id="workflow-runs-view-latest"
              variant="outline"
              onClick={handleViewLatestRun}
              disabled={!activeDefinition}
            >
              {t('runList.actions.viewLatestRun', { defaultValue: 'View latest run' })}
            </Button>
            <Button
              id="workflow-runs-run-now"
              variant="outline"
              onClick={openRunDialog}
              disabled={!canRunSelected}
            >
              {t('runList.actions.runNow', { defaultValue: 'Run now' })}
            </Button>
            <Button id="workflow-runs-export" variant="outline" onClick={handleExport}>
              {t('runList.actions.exportCsv', { defaultValue: 'Export CSV' })}
            </Button>
            <Button
              id="workflow-runs-refresh"
              variant="ghost"
              onClick={() => fetchRuns(0, false)}
              disabled={isLoading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('runList.actions.refresh', { defaultValue: 'Refresh' })}
            </Button>
            {showSelection && selectedRunIds.size > 0 && (
              <>
                <Button
                  id="workflow-runs-bulk-resume"
                  variant="outline"
                  onClick={() => setBulkAction('resume')}
                  disabled={isLoading}
                >
                  {t('runList.actions.resumeSelected', {
                    defaultValue: 'Resume selected ({{count}})',
                    count: selectedRunIds.size,
                  })}
                </Button>
                <Button
                  id="workflow-runs-bulk-cancel"
                  variant="outline"
                  onClick={() => setBulkAction('cancel')}
                  disabled={isLoading}
                >
                  {t('runList.actions.cancelSelected', {
                    defaultValue: 'Cancel selected ({{count}})',
                    count: selectedRunIds.size,
                  })}
                </Button>
                <Button
                  id="workflow-runs-clear-selection"
                  variant="ghost"
                  onClick={() => setSelectedRunIds(new Set())}
                  disabled={isLoading}
                >
                  {t('runList.actions.clearSelection', { defaultValue: 'Clear selection' })}
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {showSelection && (
                  <TableHead className="w-10">
                    <Checkbox
                      id="workflow-runs-select-all"
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={(event) => toggleSelectAll(event.target.checked)}
                      containerClassName="mb-0"
                    />
                  </TableHead>
                )}
                <TableHead>{t('runList.table.runId', { defaultValue: 'Run ID' })}</TableHead>
                <TableHead>{t('runList.table.workflow', { defaultValue: 'Workflow' })}</TableHead>
                <TableHead>{t('runList.table.version', { defaultValue: 'Version' })}</TableHead>
                {showTenantColumn && <TableHead>{t('runList.table.tenant', { defaultValue: 'Tenant' })}</TableHead>}
                <TableHead>{t('runList.table.triggerPayload', { defaultValue: 'Trigger payload' })}</TableHead>
                <TableHead>{t('runList.table.status', { defaultValue: 'Status' })}</TableHead>
                <TableHead>{t('runList.table.started', { defaultValue: 'Started' })}</TableHead>
                <TableHead>{t('runList.table.updated', { defaultValue: 'Updated' })}</TableHead>
                <TableHead>{t('runList.table.duration', { defaultValue: 'Duration' })}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.run_id} data-state={selectedRunId === run.run_id ? 'selected' : undefined}>
                  {showSelection && (
                    <TableCell>
                      <Checkbox
                        id={`workflow-runs-select-${run.run_id}`}
                        checked={selectedRunIds.has(run.run_id)}
                        onChange={() => toggleRunSelection(run.run_id)}
                        containerClassName="mb-0"
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs">
                    <Link className="text-primary-600 hover:text-primary-700" href={`/msp/workflows/runs/${run.run_id}`}>
                      {run.run_id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {run.workflow_id ? (
                        <Link
                          className="w-fit text-primary-600 hover:text-primary-700 hover:underline"
                          href={`/msp/workflow-editor/${encodeURIComponent(run.workflow_id)}`}
                        >
                          {run.workflow_name ?? run.workflow_id}
                        </Link>
                      ) : (
                        <span>{run.workflow_name ?? run.workflow_id}</span>
                      )}
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge className="bg-gray-100 text-gray-700 border-gray-200 text-[10px]">
                          {run.trigger_type
                            ? formatWorkflowRunTrigger(run.trigger_type)
                            : (workflowTriggerMap.get(run.workflow_id)
                              ?? t('runList.table.trigger.manual', { defaultValue: 'Manual' }))}
                        </Badge>
                        {isTimeTriggeredRun(run.trigger_type) && workflowScheduleStateMap.get(run.workflow_id)?.status ? (
                          <Badge
                            className={`text-[10px] ${getWorkflowScheduleStatusBadgeClass(workflowScheduleStateMap.get(run.workflow_id)?.status)}`}
                          >
                            {formatWorkflowScheduleStatus(workflowScheduleStateMap.get(run.workflow_id)?.status)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{run.workflow_version}</TableCell>
                  {showTenantColumn && (
                    <TableCell className="text-xs text-gray-500">
                      {run.tenant_id ?? t('runList.table.emptyValue', { defaultValue: '—' })}
                    </TableCell>
                  )}
                  <TableCell className="text-xs">
                    {run.source_payload_schema_ref ? (
                      <div className="flex flex-col gap-1">
                        <div className="font-mono text-[11px] text-gray-700 break-all">
                          {run.source_payload_schema_ref}
                        </div>
                        <div className="flex items-center gap-1">
                          {run.trigger_mapping_applied ? (
                            <Badge variant="info" className="text-[10px]">
                              {t('runList.table.trigger.mapped', { defaultValue: 'Mapped' })}
                            </Badge>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">
                              {t('runList.table.trigger.identity', { defaultValue: 'Identity' })}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400">
                        {t('runList.table.emptyValue', { defaultValue: '—' })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_STYLES[run.status] ?? 'bg-gray-100 text-gray-600'}>
                      {formatWorkflowRunStatus(run.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(run.started_at)}</TableCell>
                  <TableCell>{formatDateTime(run.updated_at)}</TableCell>
                  <TableCell>{formatDuration(run.started_at, run.completed_at)}</TableCell>
                  <TableCell>
                    <Button
                      id={`workflow-runs-view-${run.run_id}`}
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedRunId(run.run_id)}
                    >
                      {t('runList.actions.preview', { defaultValue: 'Preview' })}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {isLoading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center text-sm text-gray-500 py-8">
                    {t('runList.states.loading', { defaultValue: 'Loading workflow runs...' })}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center text-sm text-gray-500 py-8">
                    {t('runList.states.empty', {
                      defaultValue: 'No workflow runs match the current filters.',
                    })}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {nextCursor !== null && (
            <div className="flex justify-center border-t bg-white dark:bg-[rgb(var(--color-card))] p-4">
              <Button
                id="workflow-runs-load-more"
                variant="outline"
                onClick={() => fetchRuns(nextCursor, true)}
                disabled={isLoading}
              >
                {t('runList.actions.loadMore', { defaultValue: 'Load more' })}
              </Button>
            </div>
          )}
        </Card>

      </div>

      <Drawer
        id="workflow-run-preview-drawer"
        isOpen={Boolean(selectedRunId)}
        onClose={handleRunDetailsClose}
        width="min(92vw, 1120px)"
        hideCloseButton
      >
        {selectedRunId && (
          <div className="max-h-[calc(100vh-3rem)] min-w-0 space-y-4 overflow-y-auto pr-2">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--color-border-200))] pb-4 pr-2">
              <div>
                <div className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
                  {t('runList.preview.title', { defaultValue: 'Run preview' })}
                </div>
                <div className="text-xs text-[rgb(var(--color-text-500))]">
                  {selectedRun
                    ? t('runList.preview.position', {
                        defaultValue: '{{current}} of {{total}} loaded runs',
                        current: selectedRunIndex + 1,
                        total: runs.length,
                      })
                    : t('runList.preview.selectedRun', { defaultValue: 'Selected run' })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  id="workflow-run-preview-previous"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAdjacentRun(-1)}
                  disabled={!canSelectPreviousRun}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t('runList.preview.previous', { defaultValue: 'Previous' })}
                </Button>
                <Button
                  id="workflow-run-preview-next"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAdjacentRun(1)}
                  disabled={!canSelectNextRun}
                >
                  {t('runList.preview.next', { defaultValue: 'Next' })}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
                <Button
                  id="workflow-run-preview-open-full-page"
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.assign(`/msp/workflows/runs/${selectedRunId}`)}
                >
                  <ExternalLink className="mr-1 h-4 w-4" />
                  {t('runList.preview.openFullPage', { defaultValue: 'Open full page' })}
                </Button>
                <Button id="workflow-run-preview-close" variant="ghost" size="sm" onClick={handleRunDetailsClose}>
                  {t('runList.preview.close', { defaultValue: 'Close' })}
                </Button>
              </div>
            </div>
            <WorkflowRunDetails
              runId={selectedRunId}
              workflowName={workflowNameMap.get(selectedRun?.workflow_id ?? '')}
              workflowTrigger={workflowTriggerMap.get(selectedRun?.workflow_id ?? '')}
              canAdmin={canAdmin}
            />
          </div>
        )}
      </Drawer>

      {showSelection && (
        <>
          <ConfirmationDialog
            id="workflow-runs-bulk-resume-confirm"
            isOpen={bulkAction === 'resume'}
            title={t('runList.bulk.resumeTitle', { defaultValue: 'Resume Selected Runs' })}
            message={(
              <div className="space-y-3">
                <p>
                  {t('runList.bulk.resumeMessage', {
                    defaultValue: 'Resume {{count}} selected run(s)?',
                    count: selectedRunIds.size,
                  })}
                </p>
                <TextArea
                  id="workflow-runs-bulk-resume-reason"
                  label={t('runList.bulk.reasonLabel', { defaultValue: 'Reason' })}
                  value={bulkReason}
                  onChange={(event) => setBulkReason(event.target.value)}
                  placeholder={t('runList.bulk.resumeReasonPlaceholder', {
                    defaultValue: 'Provide a reason for resuming',
                  })}
                />
              </div>
            )}
            confirmLabel={t('runList.bulk.resumeConfirm', { defaultValue: 'Resume runs' })}
            onConfirm={() => performBulkAction('resume')}
            onClose={() => setBulkAction(null)}
          />
          <ConfirmationDialog
            id="workflow-runs-bulk-cancel-confirm"
            isOpen={bulkAction === 'cancel'}
            title={t('runList.bulk.cancelTitle', { defaultValue: 'Cancel Selected Runs' })}
            message={(
              <div className="space-y-3">
                <p>
                  {t('runList.bulk.cancelMessage', {
                    defaultValue: 'Cancel {{count}} selected run(s)? This cannot be undone.',
                    count: selectedRunIds.size,
                  })}
                </p>
                <TextArea
                  id="workflow-runs-bulk-cancel-reason"
                  label={t('runList.bulk.reasonLabel', { defaultValue: 'Reason' })}
                  value={bulkReason}
                  onChange={(event) => setBulkReason(event.target.value)}
                  placeholder={t('runList.bulk.cancelReasonPlaceholder', {
                    defaultValue: 'Provide a reason for canceling',
                  })}
                />
              </div>
            )}
            confirmLabel={t('runList.bulk.cancelConfirm', { defaultValue: 'Cancel runs' })}
            onConfirm={() => performBulkAction('cancel')}
            onClose={() => setBulkAction(null)}
          />
        </>
      )}

      <WorkflowRunDialog
        isOpen={isRunDialogOpen}
        onClose={() => setIsRunDialogOpen(false)}
        workflowId={activeDefinition?.workflow_id ?? null}
        workflowName={activeDefinition?.name ?? ''}
        triggerLabel={
          activeDefinition
            ? workflowTriggerMap.get(activeDefinition.workflow_id)
              ?? t('runList.table.trigger.manual', { defaultValue: 'Manual' })
            : t('runList.table.trigger.manual', { defaultValue: 'Manual' })
        }
        triggerEventName={activeDefinition ? (activeDefinition.trigger as any)?.eventName ?? null : null}
        payloadSchemaRef={activeDefinition?.payload_schema_ref ?? null}
        publishedVersion={activeDefinition?.published_version ?? null}
        draftVersion={null}
        isSystem={activeDefinition?.is_system ?? false}
        isPaused={activeDefinition?.is_paused ?? false}
        concurrencyLimit={activeDefinition?.concurrency_limit ?? null}
        canPublish={false}
      />
    </div>
  );
};

export default WorkflowRunList;
