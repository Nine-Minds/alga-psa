'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
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
import WorkflowRunDetails from './WorkflowRunDetails';

type WorkflowDefinitionSummary = {
  workflow_id: string;
  name: string;
  trigger?: Record<string, unknown> | null;
  payload_schema_ref?: string | null;
  published_version?: number | null;
  validation_status?: string | null;
  is_paused?: boolean;
  concurrency_limit?: number | null;
  is_system?: boolean;
};

type WorkflowRunListItem = {
  run_id: string;
  workflow_id: string;
  workflow_name?: string | null;
  workflow_version: number;
  tenant_id?: string | null;
  status: string;
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

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'WAITING', label: 'Waiting' },
  { value: 'SUCCEEDED', label: 'Succeeded' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELED', label: 'Canceled' }
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'started_at:desc', label: 'Newest first' },
  { value: 'started_at:asc', label: 'Oldest first' },
  { value: 'updated_at:desc', label: 'Recently updated' },
  { value: 'updated_at:asc', label: 'Least recently updated' }
];

const STATUS_STYLES: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  WAITING: 'bg-amber-100 text-amber-700',
  SUCCEEDED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELED: 'bg-gray-100 text-gray-600'
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

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

const buildWorkflowOptions = (definitions: WorkflowDefinitionSummary[]): SelectOption[] => [
  { value: '', label: 'All workflows' },
  ...definitions.map((definition) => ({
    value: definition.workflow_id,
    label: definition.name
  }))
];


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

  const workflowOptions = useMemo(() => buildWorkflowOptions(definitions), [definitions]);
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
      const eventName = (trigger as any)?.eventName;
      if (eventName) {
        map.set(definition.workflow_id, `Event: ${eventName}`);
        return;
      }
      map.set(definition.workflow_id, JSON.stringify(trigger));
    });
    return map;
  }, [definitions]);

  const activeDefinition = useMemo(
    () => definitions.find((definition) => definition.workflow_id === filters.workflowId) ?? null,
    [definitions, filters.workflowId]
  );

  const selectedRuns = useMemo(
    () => runs.filter((run) => selectedRunIds.has(run.run_id)),
    [runs, selectedRunIds]
  );
  const showSelection = canAdmin;

  const showTenantColumn = useMemo(() => {
    const tenants = new Set(runs.map((run) => run.tenant_id).filter(Boolean));
    return tenants.size > 1;
  }, [runs]);

  const fetchRuns = useCallback(
    async (cursor: number, append = false, overrideFilters?: WorkflowRunFilters) => {
      const activeFilters = overrideFilters ?? filters;
      setIsLoading(true);
      try {
        const data = (await listWorkflowRunsAction({
          status: activeFilters.status !== 'all' ? [activeFilters.status as any] : undefined,
          workflowId: activeFilters.workflowId || undefined,
          version: activeFilters.workflowVersion || undefined,
          search: activeFilters.search || undefined,
          from: activeFilters.from || undefined,
          to: activeFilters.to || undefined,
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
        toast.error(error instanceof Error ? error.message : 'Failed to load workflow runs');
      } finally {
        setIsLoading(false);
      }
    },
    [filters]
  );

  const fetchSummary = useCallback(
    async (overrideFilters?: WorkflowRunFilters) => {
      const activeFilters = overrideFilters ?? filters;
      try {
        const data = (await listWorkflowRunSummaryAction({
          workflowId: activeFilters.workflowId || undefined,
          version: activeFilters.workflowVersion || undefined,
          from: activeFilters.from || undefined,
          to: activeFilters.to || undefined
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
      toast.error('Select a workflow to view its latest run.');
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
        toast.error('No runs found for that workflow.');
        return;
      }
      window.location.assign(`/msp/workflows/runs/${latest.run_id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load latest run');
    }
  };

  const openRunDialog = () => {
    if (!activeDefinition) {
      toast.error('Select a workflow to run.');
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
    try {
      const result = await exportWorkflowRunsAction({
        status: filters.status !== 'all' ? [filters.status as any] : undefined,
        workflowId: filters.workflowId || undefined,
        version: filters.workflowVersion || undefined,
        search: filters.search || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
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
      toast.success('Run export ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export runs');
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
      toast.error('Select runs to perform this action.');
      setBulkAction(null);
      return;
    }
    if (bulkReason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters.');
      return;
    }

    const eligible = selectedRuns.filter((run) =>
      action === 'resume' ? run.status === 'WAITING' : !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(run.status)
    );
    const skipped = selectedRuns.length - eligible.length;

    if (eligible.length === 0) {
      toast.error('No selected runs are eligible for that action.');
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
        toast.error(`Failed to ${action} ${failed} run(s).`);
      } else {
        toast.success(`${action === 'resume' ? 'Resumed' : 'Canceled'} ${eligible.length} run(s).`);
      }
      if (skipped > 0) {
        toast(`Skipped ${skipped} ineligible run(s).`, { icon: '⚠️' });
      }
      setBulkAction(null);
      setBulkReason('');
      setSelectedRunIds(new Set());
      fetchRuns(0, false);
      fetchSummary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bulk action failed');
      setBulkAction(null);
    }
  };

  const allSelected = runs.length > 0 && selectedRunIds.size === runs.length;
  const someSelected = selectedRunIds.size > 0 && selectedRunIds.size < runs.length;
  const columnCount = (showSelection ? 10 : 9) + (showTenantColumn ? 1 : 0);
  const canRunSelected = !!activeDefinition?.workflow_id
    && canManage
    && !!activeDefinition.published_version
    && activeDefinition.validation_status !== 'error'
    && !activeDefinition.is_paused
    && (!activeDefinition.is_system || canAdmin);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button id="workflow-runs-last-24h" variant="outline" size="sm" onClick={() => applyQuickRange(24)}>
              Last 24h
            </Button>
            <Button id="workflow-runs-last-7d" variant="outline" size="sm" onClick={() => applyQuickRange(168)}>
              Last 7d
            </Button>
            {summary && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>Total: {summary.total}</span>
                {Object.entries(summary.byStatus).map(([status, count]) => (
                  <Badge key={status} className={STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}>
                    {status}: {count}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {isActive && runningWorkflowButtons.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-xs text-gray-500 shrink-0">Active workflows</span>
              <Button
                id="workflow-runs-active-all"
                variant={filters.workflowId === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyWorkflowFilter('')}
              >
                All
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
                      {workflow.status}
                    </Badge>
                    <span>{workflow.name}</span>
                    {workflow.runCount != null && (
                      <Badge className="bg-blue-50 text-blue-700">
                        {workflow.runCount} runs
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
              label="Run ID or correlation key"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="Search by run id or correlation key"
            />
            <CustomSelect
              id="workflow-runs-status"
              label="Status"
              options={STATUS_OPTIONS}
              value={filters.status}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            />
            <CustomSelect
              id="workflow-runs-workflow"
              label="Workflow"
              options={workflowOptions}
              value={filters.workflowId}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, workflowId: value }))}
            />
            <Input
              id="workflow-runs-version"
              label="Workflow version"
              type="number"
              value={filters.workflowVersion}
              onChange={(event) => setFilters((prev) => ({ ...prev, workflowVersion: event.target.value }))}
              placeholder="Any version"
            />
            <Input
              id="workflow-runs-from"
              label="From"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
            <Input
              id="workflow-runs-to"
              label="To"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
            <CustomSelect
              id="workflow-runs-sort"
              label="Sort"
              options={SORT_OPTIONS}
              value={filters.sort}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, sort: value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button id="workflow-runs-apply" onClick={handleApplyFilters} disabled={isLoading}>
              Apply filters
            </Button>
            <Button id="workflow-runs-reset" variant="outline" onClick={handleResetFilters} disabled={isLoading}>
              Reset
            </Button>
            <Button
              id="workflow-runs-view-latest"
              variant="outline"
              onClick={handleViewLatestRun}
              disabled={!activeDefinition}
            >
              View latest run
            </Button>
            <Button
              id="workflow-runs-run-now"
              variant="outline"
              onClick={openRunDialog}
              disabled={!canRunSelected}
            >
              Run now
            </Button>
            <Button id="workflow-runs-export" variant="outline" onClick={handleExport}>
              Export CSV
            </Button>
            <Button
              id="workflow-runs-refresh"
              variant="ghost"
              onClick={() => fetchRuns(0, false)}
              disabled={isLoading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {showSelection && selectedRunIds.size > 0 && (
              <>
                <Button
                  id="workflow-runs-bulk-resume"
                  variant="outline"
                  onClick={() => setBulkAction('resume')}
                  disabled={isLoading}
                >
                  Resume selected ({selectedRunIds.size})
                </Button>
                <Button
                  id="workflow-runs-bulk-cancel"
                  variant="outline"
                  onClick={() => setBulkAction('cancel')}
                  disabled={isLoading}
                >
                  Cancel selected ({selectedRunIds.size})
                </Button>
                <Button
                  id="workflow-runs-clear-selection"
                  variant="ghost"
                  onClick={() => setSelectedRunIds(new Set())}
                  disabled={isLoading}
                >
                  Clear selection
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
                <TableHead>Run ID</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Version</TableHead>
                {showTenantColumn && <TableHead>Tenant</TableHead>}
                <TableHead>Trigger payload</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Duration</TableHead>
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
                  <TableCell>{run.workflow_name ?? run.workflow_id}</TableCell>
                  <TableCell>{run.workflow_version}</TableCell>
                  {showTenantColumn && <TableCell className="text-xs text-gray-500">{run.tenant_id ?? '—'}</TableCell>}
                  <TableCell className="text-xs">
                    {run.source_payload_schema_ref ? (
                      <div className="flex flex-col gap-1">
                        <div className="font-mono text-[11px] text-gray-700 break-all">
                          {run.source_payload_schema_ref}
                        </div>
                        <div className="flex items-center gap-1">
                          {run.trigger_mapping_applied ? (
                            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">Mapped</Badge>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">Identity</Badge>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_STYLES[run.status] ?? 'bg-gray-100 text-gray-600'}>
                      {run.status}
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
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {isLoading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center text-sm text-gray-500 py-8">
                    Loading workflow runs...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center text-sm text-gray-500 py-8">
                    No workflow runs match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {nextCursor !== null && (
            <div className="flex justify-center border-t bg-white p-4">
              <Button
                id="workflow-runs-load-more"
                variant="outline"
                onClick={() => fetchRuns(nextCursor, true)}
                disabled={isLoading}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>

        {selectedRunId && (
          <Card className="p-4">
            <WorkflowRunDetails
              runId={selectedRunId}
              workflowName={workflowNameMap.get(runs.find((run) => run.run_id === selectedRunId)?.workflow_id ?? '')}
              workflowTrigger={workflowTriggerMap.get(
                runs.find((run) => run.run_id === selectedRunId)?.workflow_id ?? ''
              )}
              canAdmin={canAdmin}
              onClose={handleRunDetailsClose}
            />
          </Card>
        )}
      </div>

      {showSelection && (
        <>
          <ConfirmationDialog
            id="workflow-runs-bulk-resume-confirm"
            isOpen={bulkAction === 'resume'}
            title="Resume Selected Runs"
            message={(
              <div className="space-y-3">
                <p>Resume {selectedRunIds.size} selected run(s)?</p>
                <TextArea
                  id="workflow-runs-bulk-resume-reason"
                  label="Reason"
                  value={bulkReason}
                  onChange={(event) => setBulkReason(event.target.value)}
                  placeholder="Provide a reason for resuming"
                />
              </div>
            )}
            confirmLabel="Resume runs"
            onConfirm={() => performBulkAction('resume')}
            onClose={() => setBulkAction(null)}
          />
          <ConfirmationDialog
            id="workflow-runs-bulk-cancel-confirm"
            isOpen={bulkAction === 'cancel'}
            title="Cancel Selected Runs"
            message={(
              <div className="space-y-3">
                <p>Cancel {selectedRunIds.size} selected run(s)? This cannot be undone.</p>
                <TextArea
                  id="workflow-runs-bulk-cancel-reason"
                  label="Reason"
                  value={bulkReason}
                  onChange={(event) => setBulkReason(event.target.value)}
                  placeholder="Provide a reason for canceling"
                />
              </div>
            )}
            confirmLabel="Cancel runs"
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
        triggerLabel={activeDefinition ? workflowTriggerMap.get(activeDefinition.workflow_id) ?? 'Manual' : 'Manual'}
        triggerEventName={activeDefinition ? (activeDefinition.trigger as any)?.eventName ?? null : null}
        payloadSchemaRef={activeDefinition?.payload_schema_ref ?? null}
        publishedVersion={activeDefinition?.published_version ?? null}
        draftVersion={null}
        isSystem={activeDefinition?.is_system ?? false}
        isPaused={activeDefinition?.is_paused ?? false}
        validationStatus={activeDefinition?.validation_status ?? null}
        concurrencyLimit={activeDefinition?.concurrency_limit ?? null}
        canPublish={false}
      />
    </div>
  );
};

export default WorkflowRunList;
