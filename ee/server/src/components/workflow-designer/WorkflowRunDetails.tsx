'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Play, StopCircle, RotateCcw, Repeat, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { TextArea } from '@/components/ui/TextArea';
import {
  cancelWorkflowRunAction,
  exportWorkflowAuditLogsAction,
  exportWorkflowRunLogsAction,
  exportWorkflowRunDetailAction,
  getWorkflowDefinitionVersionAction,
  getWorkflowRunAction,
  listWorkflowAuditLogsAction,
  listWorkflowRunLogsAction,
  listWorkflowRunStepsAction,
  requeueWorkflowRunEventWaitAction,
  replayWorkflowRunAction,
  resumeWorkflowRunAction,
  retryWorkflowRunAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';

import type { WorkflowDefinition, Step, IfBlock, ForEachBlock, TryCatchBlock } from '@shared/workflow/runtime';
import { pathDepth } from '@shared/workflow/runtime/utils/nodePathUtils';

type WorkflowRunRecord = {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  node_path?: string | null;
  input_json?: Record<string, unknown> | null;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
  error_json?: Record<string, unknown> | null;
};

type WorkflowRunStepRecord = {
  step_id: string;
  run_id: string;
  step_path: string;
  definition_step_id: string;
  status: string;
  attempt: number;
  duration_ms?: number | null;
  error_json?: Record<string, unknown> | null;
  snapshot_id?: string | null;
  started_at: string;
  completed_at?: string | null;
};

type WorkflowRunSnapshotRecord = {
  snapshot_id: string;
  run_id: string;
  step_path: string;
  envelope_json: Record<string, unknown>;
  created_at: string;
};

type WorkflowActionInvocationRecord = {
  invocation_id: string;
  run_id: string;
  step_path: string;
  action_id: string;
  action_version: number;
  status: string;
  attempt: number;
  input_json?: Record<string, unknown> | null;
  output_json?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

type WorkflowRunWaitRecord = {
  wait_id: string;
  run_id: string;
  step_path: string;
  wait_type: string;
  event_name?: string | null;
  key?: string | null;
  timeout_at?: string | null;
  status: string;
  created_at: string;
  resolved_at?: string | null;
};

type WorkflowRunDetailsResponse = {
  steps: WorkflowRunStepRecord[];
  snapshots: WorkflowRunSnapshotRecord[];
  invocations: WorkflowActionInvocationRecord[];
  waits: WorkflowRunWaitRecord[];
};

type WorkflowRunLogRecord = {
  log_id: string;
  level: string;
  message: string;
  step_path?: string | null;
  event_name?: string | null;
  correlation_key?: string | null;
  context_json?: Record<string, unknown> | null;
  created_at: string;
};

type WorkflowRunLogResponse = {
  logs: WorkflowRunLogRecord[];
  nextCursor: number | null;
};

type WorkflowAuditLogRecord = {
  audit_id: string;
  timestamp: string;
  user_id?: string | null;
  operation: string;
  table_name: string;
  record_id: string;
  changed_data?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
};

type WorkflowAuditLogResponse = {
  logs: WorkflowAuditLogRecord[];
  nextCursor: number | null;
};

type WorkflowDefinitionVersionRecord = {
  definition_json: WorkflowDefinition;
};

const STATUS_STYLES: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  WAITING: 'bg-amber-100 text-amber-700',
  SUCCEEDED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELED: 'bg-gray-100 text-gray-600',
  STARTED: 'bg-blue-100 text-blue-700',
  RETRY_SCHEDULED: 'bg-amber-100 text-amber-700',
  INFO: 'bg-blue-100 text-blue-700',
  WARN: 'bg-amber-100 text-amber-700',
  ERROR: 'bg-red-100 text-red-700',
  DEBUG: 'bg-gray-100 text-gray-600'
};

const STEP_STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'STARTED', label: 'Started' },
  { value: 'SUCCEEDED', label: 'Succeeded' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'RETRY_SCHEDULED', label: 'Retry scheduled' },
  { value: 'CANCELED', label: 'Canceled' }
];

const LOG_LEVEL_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All levels' },
  { value: 'DEBUG', label: 'Debug' },
  { value: 'INFO', label: 'Info' },
  { value: 'WARN', label: 'Warn' },
  { value: 'ERROR', label: 'Error' }
];

const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization)/i;
const REDACTION_MARKER = '***';

const maskSensitiveValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => maskSensitiveValues(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (key === 'secretRef' || SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, REDACTION_MARKER];
      }
      return [key, maskSensitiveValues(val)];
    });
    return Object.fromEntries(entries);
  }
  return value;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatDurationMs = (value?: number | null) => {
  if (!value || value < 0) return '—';
  if (value < 1000) return `${value}ms`;
  const seconds = Math.round(value / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
};

const formatDuration = (start?: string | null, end?: string | null) => {
  if (!start || !end) return '—';
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return '—';
  return formatDurationMs(diffMs);
};

const safePathDepth = (path: string) => {
  try {
    return pathDepth(path);
  } catch {
    return 0;
  }
};

const buildStepTypeMap = (definition?: WorkflowDefinition | null) => {
  const map = new Map<string, string>();
  if (!definition) return map;

  const walk = (steps: Step[]) => {
    steps.forEach((step) => {
      map.set(step.id, step.type);
      if (step.type === 'control.if') {
        const ifStep = step as IfBlock;
        walk(ifStep.then);
        if (ifStep.else) {
          walk(ifStep.else);
        }
      } else if (step.type === 'control.forEach') {
        const feStep = step as ForEachBlock;
        walk(feStep.body);
      } else if (step.type === 'control.tryCatch') {
        const tcStep = step as TryCatchBlock;
        walk(tcStep.try);
        walk(tcStep.catch);
      }
    });
  };

  walk(definition.steps ?? []);
  return map;
};

const renderJson = (value: unknown) => {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value, null, 2);
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
};

const jsonSize = (value: unknown) => {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
};

const truncateJsonPreview = (value: unknown, maxChars: number) => {
  const serialized = renderJson(value);
  if (serialized.length <= maxChars) {
    return { preview: serialized, truncated: false };
  }
  return { preview: `${serialized.slice(0, maxChars)}\n… truncated …`, truncated: true };
};

interface WorkflowRunDetailsProps {
  runId: string;
  workflowName?: string;
  workflowTrigger?: string | null;
  canAdmin?: boolean;
  onClose?: () => void;
}

const WorkflowRunDetails: React.FC<WorkflowRunDetailsProps> = ({
  runId,
  workflowName,
  workflowTrigger,
  canAdmin = false,
  onClose
}) => {
  const [run, setRun] = useState<WorkflowRunRecord | null>(null);
  const [steps, setSteps] = useState<WorkflowRunStepRecord[]>([]);
  const [snapshots, setSnapshots] = useState<WorkflowRunSnapshotRecord[]>([]);
  const [invocations, setInvocations] = useState<WorkflowActionInvocationRecord[]>([]);
  const [waits, setWaits] = useState<WorkflowRunWaitRecord[]>([]);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [selectedStepPath, setSelectedStepPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    'resume' | 'cancel' | 'retry' | 'replay' | 'requeue' | null
  >(null);
  const [actionReason, setActionReason] = useState('');
  const [replayPayload, setReplayPayload] = useState<string>('{}');
  const [stepStatusFilter, setStepStatusFilter] = useState<string>('all');
  const [stepTypeFilter, setStepTypeFilter] = useState<string>('all');
  const [collapseNested, setCollapseNested] = useState(false);
  const [envelopeTab, setEnvelopeTab] = useState<string>('payload');
  const [logs, setLogs] = useState<WorkflowRunLogRecord[]>([]);
  const [logCursor, setLogCursor] = useState<number | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logFilters, setLogFilters] = useState<{ level: string; search: string }>({
    level: 'all',
    search: ''
  });
  const logLimit = 50;
  const [auditLogs, setAuditLogs] = useState<WorkflowAuditLogRecord[]>([]);
  const [auditCursor, setAuditCursor] = useState<number | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const auditLimit = 25;

  const fetchDetails = useCallback(async () => {
    setIsLoading(true);
    try {
      const [runData, stepData] = await Promise.all([
        getWorkflowRunAction({ runId }),
        listWorkflowRunStepsAction({ runId })
      ]);

      let definitionJson: WorkflowDefinition | null = null;
      try {
        if (runData?.workflow_id && runData?.workflow_version) {
          const definitionRecord = (await getWorkflowDefinitionVersionAction({
            workflowId: runData.workflow_id,
            version: runData.workflow_version
          })) as WorkflowDefinitionVersionRecord;
          definitionJson = definitionRecord.definition_json ?? null;
        }
      } catch {
        definitionJson = null;
      }

      setRun(runData);
      setSteps(stepData.steps ?? []);
      setSnapshots(stepData.snapshots ?? []);
      setInvocations(stepData.invocations ?? []);
      setWaits(stepData.waits ?? []);
      setDefinition(definitionJson);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load run details');
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  const fetchLogs = useCallback(
    async (cursor = 0, append = false, overrideFilters?: { level: string; search: string }) => {
      const activeFilters = overrideFilters ?? { level: 'all', search: '' };
      setLogLoading(true);
      try {
        const data = (await listWorkflowRunLogsAction({
          runId,
          level: activeFilters.level !== 'all' ? [activeFilters.level as any] : undefined,
          search: activeFilters.search || undefined,
          limit: logLimit,
          cursor
        })) as WorkflowRunLogResponse;
        setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
        setLogCursor(data.nextCursor ?? null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load logs');
      } finally {
        setLogLoading(false);
      }
    },
    [logLimit, runId]
  );

  const fetchAuditLogs = useCallback(
    async (cursor = 0, append = false) => {
      if (!canAdmin) {
        setAuditLogs([]);
        setAuditCursor(null);
        return;
      }
      setAuditLoading(true);
      try {
        const data = (await listWorkflowAuditLogsAction({
          tableName: 'workflow_runs',
          recordId: runId,
          limit: auditLimit,
          cursor
        })) as WorkflowAuditLogResponse;
        setAuditLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
        setAuditCursor(data.nextCursor ?? null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load audit logs');
      } finally {
        setAuditLoading(false);
      }
    },
    [auditLimit, canAdmin, runId]
  );

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  useEffect(() => {
    setSelectedStepPath(null);
    setEnvelopeTab('payload');
    setStepStatusFilter('all');
    setStepTypeFilter('all');
    setCollapseNested(false);
    setLogs([]);
    setLogCursor(null);
    const nextLogFilters = { level: 'all', search: '' };
    setLogFilters(nextLogFilters);
    fetchLogs(0, false, nextLogFilters);
    setAuditLogs([]);
    setAuditCursor(null);
    fetchAuditLogs(0, false);
  }, [fetchAuditLogs, fetchLogs, runId]);

  useEffect(() => {
    setActionReason('');
  }, [confirmAction, runId]);

  useEffect(() => {
    if (confirmAction !== 'replay') return;
    const payload = run?.input_json ?? {};
    try {
      setReplayPayload(JSON.stringify(payload, null, 2));
    } catch {
      setReplayPayload('{}');
    }
  }, [confirmAction, run]);

  useEffect(() => {
    if (steps.length === 0) return;
    const url = new URL(window.location.href);
    const stepParam = url.searchParams.get('step');
    if (stepParam && steps.some((step) => step.step_path === stepParam)) {
      if (selectedStepPath !== stepParam) {
        setSelectedStepPath(stepParam);
      }
      return;
    }
    if (!selectedStepPath) {
      setSelectedStepPath(steps[0].step_path);
    }
  }, [steps, selectedStepPath]);

  useEffect(() => {
    if (!selectedStepPath) return;
    const url = new URL(window.location.href);
    url.searchParams.set('step', selectedStepPath);
    window.history.replaceState(null, '', url.toString());
  }, [selectedStepPath]);

  const selectedStep = useMemo(
    () => steps.find((step) => step.step_path === selectedStepPath) ?? null,
    [steps, selectedStepPath]
  );
  const selectedStepError = (selectedStep?.error_json ?? null) as any;

  const stepSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.step_path === selectedStepPath),
    [snapshots, selectedStepPath]
  );

  const stepInvocations = useMemo(
    () => invocations.filter((invocation) => invocation.step_path === selectedStepPath),
    [invocations, selectedStepPath]
  );

  const stepWaits = useMemo(
    () => waits.filter((wait) => wait.step_path === selectedStepPath),
    [waits, selectedStepPath]
  );

  const retryWaitsByStep = useMemo(() => {
    const map = new Map<string, WorkflowRunWaitRecord>();
    waits.forEach((wait) => {
      if (wait.wait_type !== 'retry' || wait.status !== 'WAITING') return;
      const existing = map.get(wait.step_path);
      if (!existing || (existing.timeout_at ?? '') > (wait.timeout_at ?? '')) {
        map.set(wait.step_path, wait);
      }
    });
    return map;
  }, [waits]);

  const stepTypeById = useMemo(() => buildStepTypeMap(definition), [definition]);

  const nodeTypeOptions = useMemo(() => {
    const types = new Set<string>();
    steps.forEach((step) => {
      const type = stepTypeById.get(step.definition_step_id);
      if (type) {
        types.add(type);
      }
    });
    return [
      { value: 'all', label: 'All types' },
      ...Array.from(types).sort().map((type) => ({ value: type, label: type }))
    ];
  }, [steps, stepTypeById]);

  const filteredSteps = useMemo(() => {
    return steps.filter((step) => {
      if (stepStatusFilter !== 'all' && step.status !== stepStatusFilter) {
        return false;
      }
      if (stepTypeFilter !== 'all') {
        const type = stepTypeById.get(step.definition_step_id);
        if (type !== stepTypeFilter) return false;
      }
      if (collapseNested && safePathDepth(step.step_path) > 1) {
        return false;
      }
      return true;
    });
  }, [steps, stepStatusFilter, stepTypeFilter, stepTypeById, collapseNested]);

  const handleApplyLogFilters = () => {
    fetchLogs(0, false, logFilters);
  };

  const handleResetLogFilters = () => {
    const nextFilters = { level: 'all', search: '' };
    setLogFilters(nextFilters);
    fetchLogs(0, false, nextFilters);
  };

  const handleLogExport = async () => {
    try {
      const result = await exportWorkflowRunLogsAction({
        runId,
        level: logFilters.level !== 'all' ? [logFilters.level as any] : undefined,
        search: logFilters.search || undefined,
        limit: 5000,
        cursor: 0
      });
      const blob = new Blob([result.body], { type: result.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Log export ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export logs');
    }
  };

  const canResume = canAdmin && run?.status === 'WAITING';
  const canCancel = canAdmin && run?.status && !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(run.status);
  const canRetry = canAdmin && run?.status === 'FAILED';
  const canReplay = canAdmin && !!run;
  const hasEventWait = waits.some((wait) => wait.wait_type === 'event');
  const canRequeue = canAdmin && hasEventWait;

  const handleResume = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters.');
      return;
    }
    try {
      await resumeWorkflowRunAction({ runId: run.run_id, reason: actionReason.trim(), source: 'ui' });
      toast.success('Run resumed');
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resume run');
    }
  };

  const handleCancel = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters.');
      return;
    }
    try {
      await cancelWorkflowRunAction({ runId: run.run_id, reason: actionReason.trim(), source: 'ui' });
      toast.success('Run canceled');
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel run');
    }
  };

  const handleExport = async () => {
    if (!run) return;
    try {
      const exportData = await exportWorkflowRunDetailAction({ runId: run.run_id });
      const body = JSON.stringify(exportData, null, 2);
      const blob = new Blob([body], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `workflow-run-${run.run_id}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Run export ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export run');
    }
  };

  const handleRetry = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters.');
      return;
    }
    try {
      await retryWorkflowRunAction({ runId: run.run_id, reason: actionReason.trim(), source: 'ui' });
      toast.success('Run retry started');
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to retry run');
    }
  };

  const handleReplay = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters.');
      return;
    }
    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = replayPayload ? JSON.parse(replayPayload) : {};
    } catch (error) {
      toast.error('Replay payload must be valid JSON.');
      return;
    }

    try {
      await replayWorkflowRunAction({
        runId: run.run_id,
        reason: actionReason.trim(),
        payload: parsedPayload,
        source: 'ui'
      });
      toast.success('Run replay started');
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to replay run');
    }
  };

  const handleRequeue = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters.');
      return;
    }
    try {
      await requeueWorkflowRunEventWaitAction({
        runId: run.run_id,
        reason: actionReason.trim(),
        source: 'ui'
      });
      toast.success('Event wait requeued');
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to requeue event wait');
    }
  };

  const handleAuditExport = async () => {
    if (!canAdmin) return;
    try {
      const result = await exportWorkflowAuditLogsAction({
        tableName: 'workflow_runs',
        recordId: runId,
        format: 'csv'
      });
      const blob = new Blob([result.body], { type: result.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Audit export ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export audit logs');
    }
  };

  const latestSnapshot = stepSnapshots[stepSnapshots.length - 1];
  const redactedSnapshot = latestSnapshot ? maskSensitiveValues(latestSnapshot.envelope_json) : null;
  const envelopePayload = (redactedSnapshot as any)?.payload ?? null;
  const envelopeVars = (redactedSnapshot as any)?.vars ?? null;
  const envelopeMeta = (redactedSnapshot as any)?.meta ?? null;
  const envelopeError = (redactedSnapshot as any)?.error ?? null;
  const hasRedactions = Array.isArray((redactedSnapshot as any)?.meta?.redactions)
    ? (redactedSnapshot as any).meta.redactions.length > 0
    : false;
  const stepColumnCount = 9;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-gray-500">Run ID</div>
            <div className="text-lg font-semibold text-gray-900">{runId}</div>
            <div className="text-sm text-gray-600">
              {workflowName ?? run?.workflow_id} · v{run?.workflow_version ?? '—'}
            </div>
            <div className="text-xs text-gray-500">Workflow ID: {run?.workflow_id ?? '—'}</div>
            {workflowTrigger && (
              <div className="text-xs text-gray-500">Trigger: {workflowTrigger}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canResume && (
              <Button id="workflow-run-resume" variant="outline" onClick={() => setConfirmAction('resume')}>
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
            )}
            {canCancel && (
              <Button id="workflow-run-cancel" variant="outline" onClick={() => setConfirmAction('cancel')}>
                <StopCircle className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            )}
            {run && (
              <Button id="workflow-run-export" variant="outline" onClick={handleExport}>
                Export
              </Button>
            )}
            {canRetry && (
              <Button id="workflow-run-retry" variant="outline" onClick={() => setConfirmAction('retry')}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            )}
            {canReplay && (
              <Button id="workflow-run-replay" variant="outline" onClick={() => setConfirmAction('replay')}>
                <Repeat className="h-4 w-4 mr-2" />
                Replay
              </Button>
            )}
            {canRequeue && (
              <Button id="workflow-run-requeue" variant="outline" onClick={() => setConfirmAction('requeue')}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Requeue Event
              </Button>
            )}
            {onClose && (
              <Button id="workflow-run-close" variant="ghost" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500">Status</div>
            <Badge className={STATUS_STYLES[run?.status ?? ''] ?? 'bg-gray-100 text-gray-600'}>
              {run?.status ?? '—'}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-gray-500">Started</div>
            <div className="text-gray-800">{formatDateTime(run?.started_at)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Updated</div>
            <div className="text-gray-800">{formatDateTime(run?.updated_at)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Completed</div>
            <div className="text-gray-800">{formatDateTime(run?.completed_at)}</div>
          </div>
        </div>

        {run?.node_path && (
          <div className="text-xs text-gray-500">Node path: {run.node_path}</div>
        )}
        {run?.error_json && (
          <div className="flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <div>{String((run.error_json as any)?.message ?? 'Run error')}</div>
              <div className="text-xs text-red-600">
                {(run.error_json as any)?.category ?? 'Error'} · {formatDateTime((run.error_json as any)?.at ?? null)}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Step Timeline</div>
            <div className="text-xs text-gray-500">Attempts, durations, and errors per step.</div>
          </div>
          {isLoading && <span className="text-xs text-gray-400">Loading...</span>}
        </div>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="min-w-[180px]">
            <CustomSelect
              id="workflow-run-step-status-filter"
              label="Step status"
              options={STEP_STATUS_OPTIONS}
              value={stepStatusFilter}
              onValueChange={setStepStatusFilter}
            />
          </div>
          <div className="min-w-[220px]">
            <CustomSelect
              id="workflow-run-step-type-filter"
              label="Node type"
              options={nodeTypeOptions}
              value={stepTypeFilter}
              onValueChange={setStepTypeFilter}
            />
          </div>
          <Switch
            id="workflow-run-collapse-nested"
            checked={collapseNested}
            onCheckedChange={setCollapseNested}
            label="Collapse nested blocks"
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step Path</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempt</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Next Retry</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Error</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSteps.map((step) => (
              <TableRow
                key={step.step_id}
                data-state={selectedStepPath === step.step_path ? 'selected' : undefined}
              >
                <TableCell className="font-mono text-xs">{step.step_path}</TableCell>
                <TableCell className="text-xs text-gray-500">
                  {stepTypeById.get(step.definition_step_id) ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLES[step.status] ?? 'bg-gray-100 text-gray-600'}>
                    {step.status}
                  </Badge>
                </TableCell>
                <TableCell>{step.attempt}</TableCell>
                <TableCell>{formatDurationMs(step.duration_ms)}</TableCell>
                <TableCell className="text-xs text-gray-500">
                  {formatDateTime(retryWaitsByStep.get(step.step_path)?.timeout_at ?? null)}
                </TableCell>
                <TableCell>{formatDateTime(step.started_at)}</TableCell>
                <TableCell className="text-xs text-red-600">
                  {(step.error_json as any)?.message ?? '—'}
                </TableCell>
                <TableCell>
                  <Button
                    id={`workflow-run-step-${step.step_id}`}
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedStepPath(step.step_path)}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filteredSteps.length === 0 && (
              <TableRow>
                <TableCell colSpan={stepColumnCount} className="text-center text-sm text-gray-500 py-6">
                  No step history yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {selectedStep && (
        <Card className="p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-800">Step Details</div>
            <div className="text-xs text-gray-500">{selectedStep.step_path}</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">Status</div>
              <Badge className={STATUS_STYLES[selectedStep.status] ?? 'bg-gray-100 text-gray-600'}>
                {selectedStep.status}
              </Badge>
            </div>
            <div>
              <div className="text-xs text-gray-500">Attempt</div>
              <div className="text-gray-800">{selectedStep.attempt}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Started</div>
              <div className="text-gray-800">{formatDateTime(selectedStep.started_at)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Completed</div>
              <div className="text-gray-800">{formatDateTime(selectedStep.completed_at)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">Duration</div>
              <div className="text-gray-800">{formatDurationMs(selectedStep.duration_ms)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Node Type</div>
              <div className="text-gray-800">{stepTypeById.get(selectedStep.definition_step_id) ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Definition Step ID</div>
              <div className="font-mono text-xs text-gray-700">{selectedStep.definition_step_id}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Next Retry</div>
              <div className="text-gray-800">
                {formatDateTime(retryWaitsByStep.get(selectedStep.step_path)?.timeout_at ?? null)}
              </div>
            </div>
          </div>

          {selectedStepError && (
            <Card className="p-3 border border-red-200 bg-red-50">
              <div className="text-xs font-semibold text-red-700">Error</div>
              <div className="text-sm text-red-700">
                {String(selectedStepError.message ?? 'Step error')}
              </div>
              <div className="text-xs text-red-600">
                {selectedStepError.category ?? 'Error'} · {formatDateTime(selectedStepError.at ?? null)}
              </div>
            </Card>
          )}

          {stepWaits.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700">Wait History</div>
              <div className="mt-2 space-y-2">
                {stepWaits.map((wait) => (
                  <Card key={wait.wait_id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-gray-700">
                        {wait.wait_type.toUpperCase()} · {wait.status}
                      </div>
                      <div className="text-xs text-gray-500">{formatDateTime(wait.created_at)}</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Event: {wait.event_name ?? '—'} · Key: {wait.key ?? '—'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Timeout: {formatDateTime(wait.timeout_at)} · Resolved: {formatDateTime(wait.resolved_at)}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-sm font-medium text-gray-700">Envelope Data</div>
            <div className="text-xs text-gray-500">Payload, vars, meta, and error from the latest snapshot.</div>
            {hasRedactions && (
              <div className="text-xs text-amber-600 mt-1">Redacted values shown as {REDACTION_MARKER}.</div>
            )}
            <Tabs value={envelopeTab} onValueChange={setEnvelopeTab} className="mt-2">
              <TabsList className="mb-2">
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="vars">Vars</TabsTrigger>
                <TabsTrigger value="meta">Meta</TabsTrigger>
                <TabsTrigger value="error">Error</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
              <TabsContent value="payload">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopePayload) : 'No snapshot available.'}
                </pre>
              </TabsContent>
              <TabsContent value="vars">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopeVars) : 'No snapshot available.'}
                </pre>
              </TabsContent>
              <TabsContent value="meta">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopeMeta) : 'No snapshot available.'}
                </pre>
              </TabsContent>
              <TabsContent value="error">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopeError) : 'No snapshot available.'}
                </pre>
              </TabsContent>
              <TabsContent value="raw">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(redactedSnapshot) : 'No snapshot available.'}
                </pre>
              </TabsContent>
            </Tabs>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700">Action Invocations</div>
            {hasRedactions && (
              <div className="text-xs text-amber-600 mt-1">Redacted values shown as {REDACTION_MARKER}.</div>
            )}
            {stepInvocations.length === 0 && (
              <div className="text-xs text-gray-500 mt-2">No action calls recorded for this step.</div>
            )}
            {stepInvocations.map((invocation) => {
              const inputSize = jsonSize(invocation.input_json);
              const outputSize = jsonSize(invocation.output_json);
              const inputPreview = truncateJsonPreview(maskSensitiveValues(invocation.input_json), 4000);
              const outputPreview = truncateJsonPreview(maskSensitiveValues(invocation.output_json), 4000);
              return (
                <Card key={invocation.invocation_id} className="p-3 mt-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-800">
                      {invocation.action_id}@{invocation.action_version}
                    </div>
                    <Badge className={STATUS_STYLES[invocation.status] ?? 'bg-gray-100 text-gray-600'}>
                      {invocation.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-500">Attempt {invocation.attempt}</div>
                  <div className="text-xs text-gray-500">
                    Duration: {formatDuration(invocation.started_at, invocation.completed_at)}
                  </div>
                  {invocation.error_message && (
                    <div className="text-xs text-red-600 mt-1">{invocation.error_message}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    Input size: {formatBytes(inputSize)}{inputPreview.truncated ? ' (truncated)' : ''} · Output size: {formatBytes(outputSize)}{outputPreview.truncated ? ' (truncated)' : ''}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <div className="text-xs font-semibold text-gray-500">Input</div>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-2">
                        {invocation.input_json ? inputPreview.preview : '—'}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500">Output</div>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-2">
                        {invocation.output_json ? outputPreview.preview : '—'}
                      </pre>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700">Run Logs</div>
            <div className="text-xs text-gray-500">Operational log events for this run.</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Input
                id="workflow-run-logs-search"
                label="Search"
                value={logFilters.search}
                onChange={(event) => setLogFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder="Search log message"
              />
              <CustomSelect
                id="workflow-run-logs-level"
                label="Level"
                options={LOG_LEVEL_OPTIONS}
                value={logFilters.level}
                onValueChange={(value) => setLogFilters((prev) => ({ ...prev, level: value }))}
              />
              <div className="flex items-end gap-2">
                <Button id="workflow-run-logs-apply" onClick={handleApplyLogFilters} disabled={logLoading}>
                  Apply
                </Button>
                <Button
                  id="workflow-run-logs-reset"
                  variant="outline"
                  onClick={handleResetLogFilters}
                  disabled={logLoading}
                >
                  Reset
                </Button>
                <Button
                  id="workflow-run-logs-export"
                  variant="outline"
                  onClick={handleLogExport}
                >
                  Export CSV
                </Button>
              </div>
            </div>
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Correlation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.log_id}>
                      <TableCell className="text-xs text-gray-500">{formatDateTime(log.created_at)}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_STYLES[log.level] ?? 'bg-gray-100 text-gray-600'}>
                          {log.level}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-800">{log.message}</div>
                        {log.context_json && (
                          <pre className="mt-1 max-h-24 overflow-auto rounded bg-gray-900 text-gray-100 text-xs p-2">
                            {truncateJsonPreview(log.context_json, 2000).preview}
                          </pre>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{log.step_path ?? '—'}</TableCell>
                      <TableCell className="text-xs text-gray-500">{log.event_name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-gray-500">{log.correlation_key ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                  {!logLoading && logs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-gray-500 py-6">
                        No log entries found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {logCursor !== null && (
                <div className="flex justify-center mt-3">
                  <Button
                    id="workflow-run-logs-load-more"
                    variant="outline"
                    onClick={() => fetchLogs(logCursor, true, logFilters)}
                    disabled={logLoading}
                  >
                    Load more
                  </Button>
                </div>
              )}
            </div>
          </div>

          {canAdmin && (
            <div>
              <div className="text-sm font-medium text-gray-700">Audit Trail</div>
              <div className="text-xs text-gray-500">Administrative actions for this run.</div>
              <div className="flex items-center gap-2 mt-2">
                <Button
                  id="workflow-run-audit-export"
                  variant="outline"
                  onClick={handleAuditExport}
                >
                  Export Audit CSV
                </Button>
              </div>
              <div className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.map((log) => (
                      <TableRow key={log.audit_id}>
                        <TableCell className="text-xs text-gray-500">{formatDateTime(log.timestamp)}</TableCell>
                        <TableCell className="text-xs text-gray-700">{log.operation}</TableCell>
                        <TableCell className="text-xs text-gray-500">{log.user_id ?? 'system'}</TableCell>
                        <TableCell>
                          {log.details ? (
                            <pre className="max-h-24 overflow-auto rounded bg-gray-900 text-gray-100 text-xs p-2">
                              {truncateJsonPreview(log.details, 2000).preview}
                            </pre>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!auditLoading && auditLogs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-gray-500 py-6">
                          No audit entries yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {auditCursor !== null && (
                  <div className="flex justify-center mt-3">
                    <Button
                      id="workflow-run-audit-load-more"
                      variant="outline"
                      onClick={() => fetchAuditLogs(auditCursor, true)}
                      disabled={auditLoading}
                    >
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      <ConfirmationDialog
        id="workflow-run-resume-confirm"
        isOpen={confirmAction === 'resume'}
        title="Resume Workflow Run"
        message={(
          <div className="space-y-3">
            <p>Resume this workflow run now?</p>
            <TextArea
              id="workflow-run-resume-reason"
              label="Reason"
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder="Provide a reason for resuming"
            />
          </div>
        )}
        confirmLabel="Resume"
        onConfirm={handleResume}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-cancel-confirm"
        isOpen={confirmAction === 'cancel'}
        title="Cancel Workflow Run"
        message={(
          <div className="space-y-3">
            <p>Cancel this workflow run? This cannot be undone.</p>
            <TextArea
              id="workflow-run-cancel-reason"
              label="Reason"
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder="Provide a reason for canceling"
            />
          </div>
        )}
        confirmLabel="Cancel run"
        onConfirm={handleCancel}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-retry-confirm"
        isOpen={confirmAction === 'retry'}
        title="Retry Workflow Run"
        message={(
          <div className="space-y-3">
            <p>Retry this run from the last failed step?</p>
            <TextArea
              id="workflow-run-retry-reason"
              label="Reason"
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder="Provide a reason for retrying"
            />
          </div>
        )}
        confirmLabel="Retry run"
        onConfirm={handleRetry}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-replay-confirm"
        isOpen={confirmAction === 'replay'}
        title="Replay Workflow Run"
        message={(
          <div className="space-y-3">
            <p>Replay this run with a new payload.</p>
            <TextArea
              id="workflow-run-replay-reason"
              label="Reason"
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder="Provide a reason for replaying"
            />
            <TextArea
              id="workflow-run-replay-payload"
              label="Payload (JSON)"
              value={replayPayload}
              onChange={(event) => setReplayPayload(event.target.value)}
              placeholder={'{"example": true}'}
              className="font-mono text-xs"
              rows={6}
            />
          </div>
        )}
        confirmLabel="Replay run"
        onConfirm={handleReplay}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-requeue-confirm"
        isOpen={confirmAction === 'requeue'}
        title="Requeue Event Wait"
        message={(
          <div className="space-y-3">
            <p>Requeue the most recent event wait for this run?</p>
            <TextArea
              id="workflow-run-requeue-reason"
              label="Reason"
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder="Provide a reason for requeuing"
            />
          </div>
        )}
        confirmLabel="Requeue wait"
        onConfirm={handleRequeue}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
};

export default WorkflowRunDetails;
