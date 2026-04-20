'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Play, StopCircle, RotateCcw, Repeat, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { mapWorkflowServerError } from './workflowServerErrors';

import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import {
  cancelWorkflowRunAction,
  exportWorkflowAuditLogsAction,
  exportWorkflowRunLogsAction,
  exportWorkflowRunDetailAction,
  getWorkflowDefinitionVersionAction,
  getWorkflowRunAction,
  getWorkflowScheduleStateAction,
  listWorkflowAuditLogsAction,
  listWorkflowRunLogsAction,
  listWorkflowRunStepsAction,
  requeueWorkflowRunEventWaitAction,
  replayWorkflowRunAction,
  resumeWorkflowRunAction,
  retryWorkflowRunAction
} from '@alga-psa/workflows/actions';
import {
  useFormatWorkflowLogLevel,
  useFormatWorkflowRunStatus,
  useFormatWorkflowStepStatus,
  useWorkflowLogLevelOptions,
  useWorkflowStepStatusOptions,
} from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';

import type { WorkflowDefinition, Step, IfBlock, ForEachBlock, TryCatchBlock } from '@alga-psa/workflows/runtime/client';
import { pathDepth } from '@alga-psa/workflows/authoring';
import {
  getWorkflowScheduleStatusBadgeClass,
  isTimeTriggeredRun
} from './workflowRunTriggerPresentation';
import {
  useFormatWorkflowRunTrigger,
  useFormatWorkflowScheduleStatus,
} from './useWorkflowRunTriggerPresentation';

type WorkflowRunRecord = {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  node_path?: string | null;
  trigger_type?: 'event' | 'schedule' | 'recurring' | null;
  trigger_metadata_json?: Record<string, unknown> | null;
  event_type?: string | null;
  source_payload_schema_ref?: string | null;
  trigger_mapping_applied?: boolean | null;
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
  payload?: Record<string, unknown> | null;
  created_at: string;
  resolved_at?: string | null;
};

type WorkflowRunDetailsResponse = {
  steps: WorkflowRunStepRecord[];
  snapshots: WorkflowRunSnapshotRecord[];
  invocations: WorkflowActionInvocationRecord[];
  waits: WorkflowRunWaitRecord[];
};

type WorkflowScheduleStateSummary = {
  status?: 'scheduled' | 'paused' | 'disabled' | 'completed' | 'failed' | null;
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
  definition_json: Record<string, unknown> | null;
};

const STATUS_STYLES: Record<string, string> = {
  RUNNING: 'bg-info/15 text-info-foreground',
  WAITING: 'bg-warning/15 text-warning-foreground',
  SUCCEEDED: 'bg-success/15 text-success',
  FAILED: 'bg-destructive/15 text-destructive',
  CANCELED: 'bg-muted text-muted-foreground',
  STARTED: 'bg-info/15 text-info-foreground',
  RETRY_SCHEDULED: 'bg-warning/15 text-warning-foreground',
  INFO: 'bg-info/15 text-info-foreground',
  WARN: 'bg-warning/15 text-warning-foreground',
  ERROR: 'bg-destructive/15 text-destructive',
  DEBUG: 'bg-muted text-muted-foreground'
};

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
  const { t } = useTranslation('msp/workflows');
  const formatWorkflowRunStatus = useFormatWorkflowRunStatus();
  const formatWorkflowStepStatus = useFormatWorkflowStepStatus();
  const formatWorkflowLogLevel = useFormatWorkflowLogLevel();
  const formatWorkflowRunTrigger = useFormatWorkflowRunTrigger();
  const formatWorkflowScheduleStatus = useFormatWorkflowScheduleStatus();
  const formatDateTime = useFormatDateTime();
  const workflowStepStatusOptions = useWorkflowStepStatusOptions();
  const workflowLogLevelOptions = useWorkflowLogLevelOptions();
  const [run, setRun] = useState<WorkflowRunRecord | null>(null);
  const [scheduleState, setScheduleState] = useState<WorkflowScheduleStateSummary | null>(null);
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
  const selectedStepPathRef = useRef<string | null>(null);
  const emptyValueLabel = t('runDetails.common.emptyValue', { defaultValue: '—' });
  const reasonLabel = t('runDetails.dialogs.reasonLabel', { defaultValue: 'Reason' });
  const noSnapshotLabel = t('runDetails.envelope.noSnapshot', { defaultValue: 'No snapshot available.' });
  const noActionCallsLabel = t('runDetails.invocations.empty', {
    defaultValue: 'No action calls recorded for this step.',
  });
  const noLogEntriesLabel = t('runDetails.logs.empty', { defaultValue: 'No log entries found.' });
  const noAuditEntriesLabel = t('runDetails.audit.empty', { defaultValue: 'No audit entries yet.' });
  const reasonTooShortLabel = t('runDetails.toasts.reasonTooShort', {
    defaultValue: 'Reason must be at least 3 characters.',
  });

  const fetchDetails = useCallback(async () => {
    setIsLoading(true);
    try {
      const [runData, stepData] = await Promise.all([
        getWorkflowRunAction({ runId }),
        listWorkflowRunStepsAction({ runId })
      ]);

      let definitionJson: WorkflowDefinition | null = null;
      let nextScheduleState: WorkflowScheduleStateSummary | null = null;
      try {
        if (runData?.workflow_id && runData?.workflow_version) {
          const definitionRecord = (await getWorkflowDefinitionVersionAction({
            workflowId: runData.workflow_id,
            version: runData.workflow_version
          })) as WorkflowDefinitionVersionRecord;
          definitionJson = (definitionRecord.definition_json as WorkflowDefinition) ?? null;
        }
      } catch {
        definitionJson = null;
      }

      try {
        if (runData?.workflow_id) {
          nextScheduleState = (await getWorkflowScheduleStateAction({
            workflowId: runData.workflow_id
          })) as WorkflowScheduleStateSummary | null;
        }
      } catch {
        nextScheduleState = null;
      }

      setRun(runData);
      setScheduleState(nextScheduleState);
      setSteps(stepData.steps ?? []);
      setSnapshots(stepData.snapshots ?? []);
      setInvocations(stepData.invocations ?? []);
      setWaits(stepData.waits ?? []);
      setDefinition(definitionJson);
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.loadRunDetailsFailed', { defaultValue: 'Failed to load run details' })));
      if (onClose) {
        onClose();
      }
    } finally {
      setIsLoading(false);
    }
  }, [runId, onClose, t]);

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
        toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.loadLogsFailed', { defaultValue: 'Failed to load logs' })));
      } finally {
        setLogLoading(false);
      }
    },
    [logLimit, runId, t]
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
        toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.loadAuditLogsFailed', { defaultValue: 'Failed to load audit logs' })));
      } finally {
        setAuditLoading(false);
      }
    },
    [auditLimit, canAdmin, runId, t]
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
    selectedStepPathRef.current = selectedStepPath;
  }, [selectedStepPath]);

  useEffect(() => {
    if (steps.length === 0) return;
    const url = new URL(window.location.href);
    const stepParam = url.searchParams.get('step');
    const currentSelection = selectedStepPathRef.current;
    let nextSelection: string | null = null;
    if (stepParam && steps.some((step) => step.step_path === stepParam)) {
      nextSelection = stepParam;
    } else if (currentSelection && steps.some((step) => step.step_path === currentSelection)) {
      nextSelection = currentSelection;
    } else {
      nextSelection = steps[0].step_path;
    }
    if (nextSelection && nextSelection !== currentSelection) {
      setSelectedStepPath(nextSelection);
    }
  }, [steps]);

  useEffect(() => {
    if (!selectedStepPath) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('step') === selectedStepPath) return;
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
  const stepStatusOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: 'all',
        label: t('filters.allStatuses', { defaultValue: 'All statuses' }),
      },
      ...workflowStepStatusOptions,
    ],
    [t, workflowStepStatusOptions]
  );
  const logLevelOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: 'all',
        label: t('filters.allLevels', { defaultValue: 'All levels' }),
      },
      ...workflowLogLevelOptions,
    ],
    [t, workflowLogLevelOptions]
  );

  const nodeTypeOptions = useMemo(() => {
    const types = new Set<string>();
    steps.forEach((step) => {
      const type = stepTypeById.get(step.definition_step_id);
      if (type) {
        types.add(type);
      }
    });
    return [
      { value: 'all', label: t('filters.allTypes', { defaultValue: 'All types' }) },
      ...Array.from(types).sort().map((type) => ({ value: type, label: type }))
    ];
  }, [steps, stepTypeById, t]);

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
      toast.success(t('runDetails.toasts.logExportReady', { defaultValue: 'Log export ready' }));
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.exportLogsFailed', { defaultValue: 'Failed to export logs' })));
    }
  };

  const triggerLabel = formatWorkflowRunTrigger(run?.trigger_type ?? null, run?.event_type ?? null);
  const triggerMetadata = (run?.trigger_metadata_json ?? null) as Record<string, unknown> | null;
  const canResume = canAdmin && run?.status === 'WAITING';
  const canCancel = canAdmin && run?.status && !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(run.status);
  const canRetry = canAdmin && run?.status === 'FAILED';
  const canReplay = canAdmin && !!run;
  const hasEventWait = waits.some((wait) => wait.wait_type === 'event');
  const canRequeue = canAdmin && hasEventWait;

  const handleResume = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error(reasonTooShortLabel);
      return;
    }
    try {
      await resumeWorkflowRunAction({ runId: run.run_id, reason: actionReason.trim(), source: 'ui' });
      toast.success(t('runDetails.toasts.runResumed', { defaultValue: 'Run resumed' }));
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.resumeRunFailed', { defaultValue: 'Failed to resume run' })));
    }
  };

  const handleCancel = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error(reasonTooShortLabel);
      return;
    }
    try {
      await cancelWorkflowRunAction({ runId: run.run_id, reason: actionReason.trim(), source: 'ui' });
      toast.success(t('runDetails.toasts.runCanceled', { defaultValue: 'Run canceled' }));
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.cancelRunFailed', { defaultValue: 'Failed to cancel run' })));
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
      toast.success(t('runDetails.toasts.runExportReady', { defaultValue: 'Run export ready' }));
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.exportRunFailed', { defaultValue: 'Failed to export run' })));
    }
  };

  const handleRetry = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error(reasonTooShortLabel);
      return;
    }
    try {
      await retryWorkflowRunAction({ runId: run.run_id, reason: actionReason.trim(), source: 'ui' });
      toast.success(t('runDetails.toasts.runRetryStarted', { defaultValue: 'Run retry started' }));
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.retryRunFailed', { defaultValue: 'Failed to retry run' })));
    }
  };

  const handleReplay = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error(reasonTooShortLabel);
      return;
    }
    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = replayPayload ? JSON.parse(replayPayload) : {};
    } catch (error) {
      toast.error(
        t('runDetails.toasts.replayPayloadInvalid', {
          defaultValue: 'Replay payload must be valid JSON.',
        })
      );
      return;
    }

    try {
      await replayWorkflowRunAction({
        runId: run.run_id,
        reason: actionReason.trim(),
        payload: parsedPayload,
        source: 'ui'
      });
      toast.success(t('runDetails.toasts.runReplayStarted', { defaultValue: 'Run replay started' }));
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.replayRunFailed', { defaultValue: 'Failed to replay run' })));
    }
  };

  const handleRequeue = async () => {
    if (!run) return;
    if (actionReason.trim().length < 3) {
      toast.error(reasonTooShortLabel);
      return;
    }
    try {
      await requeueWorkflowRunEventWaitAction({
        runId: run.run_id,
        reason: actionReason.trim(),
        source: 'ui'
      });
      toast.success(t('runDetails.toasts.eventWaitRequeued', { defaultValue: 'Event wait requeued' }));
      setConfirmAction(null);
      fetchDetails();
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.requeueEventWaitFailed', {
              defaultValue: 'Failed to requeue event wait',
            })));
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
      toast.success(t('runDetails.toasts.auditExportReady', { defaultValue: 'Audit export ready' }));
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDetails.toasts.exportAuditLogsFailed', {
              defaultValue: 'Failed to export audit logs',
            })));
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
            <div className="text-sm text-gray-500">
              {t('runDetails.header.runIdLabel', { defaultValue: 'Run ID' })}
            </div>
            <div id="workflow-run-detail-id" className="text-lg font-semibold text-gray-900">
              {runId}
            </div>
            <div className="text-sm text-gray-600">
              {workflowName ?? run?.workflow_id} · v{run?.workflow_version ?? emptyValueLabel}
            </div>
            <div className="text-xs text-gray-500">
              {t('runDetails.header.workflowIdLabel', { defaultValue: 'Workflow ID:' })} {run?.workflow_id ?? emptyValueLabel}
            </div>
            {workflowTrigger && (
              <div className="text-xs text-gray-500">
                {t('runDetails.header.triggerLabel', { defaultValue: 'Trigger:' })} {workflowTrigger}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canResume && (
              <Button id="workflow-run-resume" variant="outline" onClick={() => setConfirmAction('resume')}>
                <Play className="h-4 w-4 mr-2" />
                {t('runDetails.actions.resume', { defaultValue: 'Resume' })}
              </Button>
            )}
            {canCancel && (
              <Button id="workflow-run-cancel" variant="outline" onClick={() => setConfirmAction('cancel')}>
                <StopCircle className="h-4 w-4 mr-2" />
                {t('runDetails.actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
            )}
            {run && (
              <Button id="workflow-run-export" variant="outline" onClick={handleExport}>
                {t('runDetails.actions.export', { defaultValue: 'Export' })}
              </Button>
            )}
            {canRetry && (
              <Button id="workflow-run-retry" variant="outline" onClick={() => setConfirmAction('retry')}>
                <RotateCcw className="h-4 w-4 mr-2" />
                {t('runDetails.actions.retry', { defaultValue: 'Retry' })}
              </Button>
            )}
            {canReplay && (
              <Button id="workflow-run-replay" variant="outline" onClick={() => setConfirmAction('replay')}>
                <Repeat className="h-4 w-4 mr-2" />
                {t('runDetails.actions.replay', { defaultValue: 'Replay' })}
              </Button>
            )}
            {canRequeue && (
              <Button id="workflow-run-requeue" variant="outline" onClick={() => setConfirmAction('requeue')}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('runDetails.actions.requeueEvent', { defaultValue: 'Requeue Event' })}
              </Button>
            )}
            {onClose && (
              <Button id="workflow-run-close" variant="ghost" onClick={onClose}>
                {t('runDetails.actions.close', { defaultValue: 'Close' })}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500">
              {t('runDetails.summary.statusLabel', { defaultValue: 'Status' })}
            </div>
            <Badge id="workflow-run-detail-status" className={STATUS_STYLES[run?.status ?? ''] ?? 'bg-gray-100 text-gray-600'}>
              {run?.status ? formatWorkflowRunStatus(run.status) : emptyValueLabel}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-gray-500">
              {t('runDetails.summary.startedLabel', { defaultValue: 'Started' })}
            </div>
            <div className="text-gray-800">{formatDateTime(run?.started_at)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">
              {t('runDetails.summary.updatedLabel', { defaultValue: 'Updated' })}
            </div>
            <div className="text-gray-800">{formatDateTime(run?.updated_at)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">
              {t('runDetails.summary.completedLabel', { defaultValue: 'Completed' })}
            </div>
            <div className="text-gray-800">{formatDateTime(run?.completed_at)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">
              {t('runDetails.summary.triggerLabel', { defaultValue: 'Trigger' })}
            </div>
            <div className="text-gray-800">{triggerLabel}</div>
          </div>
          {isTimeTriggeredRun(run?.trigger_type) && (
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.summary.scheduleStateLabel', { defaultValue: 'Schedule state' })}
              </div>
              <Badge className={getWorkflowScheduleStatusBadgeClass(scheduleState?.status)}>
                {formatWorkflowScheduleStatus(scheduleState?.status)}
              </Badge>
            </div>
          )}
          {isTimeTriggeredRun(run?.trigger_type) && typeof triggerMetadata?.scheduledFor === 'string' && (
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.summary.scheduledForLabel', { defaultValue: 'Scheduled for' })}
              </div>
              <div className="text-gray-800">{formatDateTime(String(triggerMetadata.scheduledFor))}</div>
            </div>
          )}
          {run?.trigger_type === 'recurring' && typeof triggerMetadata?.cron === 'string' && (
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.summary.cronLabel', { defaultValue: 'Cron' })}
              </div>
              <div className="font-mono text-gray-800">{String(triggerMetadata.cron)}</div>
            </div>
          )}
        </div>

        {run?.node_path && (
          <div className="text-xs text-gray-500">
            {t('runDetails.summary.nodePathLabel', { defaultValue: 'Node path:' })} {run.node_path}
          </div>
        )}
        {run?.event_type && (
          <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
            <span>{t('runDetails.summary.eventTypeLabel', { defaultValue: 'Event type:' })}</span>
            <span className="font-mono break-all">{run.event_type}</span>
          </div>
        )}
        {run?.source_payload_schema_ref && (
          <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
            <span>
              {t('runDetails.summary.triggerPayloadSchemaLabel', {
                defaultValue: 'Trigger payload schema:',
              })}
            </span>
            <span className="font-mono break-all">{run.source_payload_schema_ref}</span>
            {run.trigger_mapping_applied ? (
              <Badge variant="info" className="text-[10px]">
                {t('runDetails.summary.mapped', { defaultValue: 'Mapped' })}
              </Badge>
            ) : (
              <Badge variant="default-muted" className="text-[10px]">
                {t('runDetails.summary.identity', { defaultValue: 'Identity' })}
              </Badge>
            )}
          </div>
        )}
        {run?.error_json && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <div>
                {String((run.error_json as any)?.message
                  ?? t('runDetails.summary.runErrorFallback', { defaultValue: 'Run error' }))}
              </div>
              <div className="text-xs text-destructive">
                {(run.error_json as any)?.category
                  ?? t('runDetails.summary.errorCategoryFallback', { defaultValue: 'Error' })} · {formatDateTime((run.error_json as any)?.at ?? null)}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">
              {t('runDetails.stepTimeline.title', { defaultValue: 'Step Timeline' })}
            </div>
            <div className="text-xs text-gray-500">
              {t('runDetails.stepTimeline.description', {
                defaultValue: 'Attempts, durations, and errors per step.',
              })}
            </div>
          </div>
          {isLoading && (
            <span className="text-xs text-gray-400">
              {t('runDetails.stepTimeline.loading', { defaultValue: 'Loading...' })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="min-w-[180px]">
            <CustomSelect
              id="workflow-run-step-status-filter"
              label={t('runDetails.stepTimeline.stepStatusLabel', { defaultValue: 'Step status' })}
              options={stepStatusOptions}
              value={stepStatusFilter}
              onValueChange={setStepStatusFilter}
            />
          </div>
          <div className="min-w-[220px]">
            <CustomSelect
              id="workflow-run-step-type-filter"
              label={t('runDetails.stepTimeline.nodeTypeLabel', { defaultValue: 'Node type' })}
              options={nodeTypeOptions}
              value={stepTypeFilter}
              onValueChange={setStepTypeFilter}
            />
          </div>
          <Switch
            id="workflow-run-collapse-nested"
            checked={collapseNested}
            onCheckedChange={setCollapseNested}
            label={t('runDetails.stepTimeline.collapseNestedLabel', {
              defaultValue: 'Collapse nested blocks',
            })}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('runDetails.stepTimeline.columns.stepPath', { defaultValue: 'Step Path' })}</TableHead>
              <TableHead>{t('runDetails.stepTimeline.columns.type', { defaultValue: 'Type' })}</TableHead>
              <TableHead>{t('runDetails.stepTimeline.columns.status', { defaultValue: 'Status' })}</TableHead>
              <TableHead>{t('runDetails.stepTimeline.columns.attempt', { defaultValue: 'Attempt' })}</TableHead>
              <TableHead>{t('runDetails.stepTimeline.columns.duration', { defaultValue: 'Duration' })}</TableHead>
              <TableHead>{t('runDetails.stepTimeline.columns.nextRetry', { defaultValue: 'Next Retry' })}</TableHead>
              <TableHead>{t('runDetails.stepTimeline.columns.started', { defaultValue: 'Started' })}</TableHead>
              <TableHead>{t('runDetails.stepTimeline.columns.error', { defaultValue: 'Error' })}</TableHead>
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
                  {stepTypeById.get(step.definition_step_id) ?? emptyValueLabel}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLES[step.status] ?? 'bg-gray-100 text-gray-600'}>
                    {formatWorkflowStepStatus(step.status)}
                  </Badge>
                </TableCell>
                <TableCell>{step.attempt}</TableCell>
                <TableCell>{formatDurationMs(step.duration_ms)}</TableCell>
                <TableCell className="text-xs text-gray-500">
                  {formatDateTime(retryWaitsByStep.get(step.step_path)?.timeout_at ?? null)}
                </TableCell>
                <TableCell>{formatDateTime(step.started_at)}</TableCell>
                <TableCell className="text-xs text-destructive">
                  {(step.error_json as any)?.message ?? emptyValueLabel}
                </TableCell>
                <TableCell>
                  <Button
                    id={`workflow-run-step-${step.step_id}`}
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedStepPath(step.step_path)}
                  >
                    {t('runDetails.actions.view', { defaultValue: 'View' })}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filteredSteps.length === 0 && (
              <TableRow>
                <TableCell colSpan={stepColumnCount} className="text-center text-sm text-gray-500 py-6">
                  {t('runDetails.stepTimeline.empty', { defaultValue: 'No step history yet.' })}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {selectedStep && (
        <Card className="p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-800">
              {t('runDetails.stepDetails.title', { defaultValue: 'Step Details' })}
            </div>
            <div className="text-xs text-gray-500">{selectedStep.step_path}</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.statusLabel', { defaultValue: 'Status' })}
              </div>
              <Badge className={STATUS_STYLES[selectedStep.status] ?? 'bg-gray-100 text-gray-600'}>
                {formatWorkflowStepStatus(selectedStep.status)}
              </Badge>
            </div>
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.attemptLabel', { defaultValue: 'Attempt' })}
              </div>
              <div className="text-gray-800">{selectedStep.attempt}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.startedLabel', { defaultValue: 'Started' })}
              </div>
              <div className="text-gray-800">{formatDateTime(selectedStep.started_at)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.completedLabel', { defaultValue: 'Completed' })}
              </div>
              <div className="text-gray-800">{formatDateTime(selectedStep.completed_at)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.durationLabel', { defaultValue: 'Duration' })}
              </div>
              <div className="text-gray-800">{formatDurationMs(selectedStep.duration_ms)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.nodeTypeLabel', { defaultValue: 'Node Type' })}
              </div>
              <div className="text-gray-800">{stepTypeById.get(selectedStep.definition_step_id) ?? emptyValueLabel}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.definitionStepIdLabel', {
                  defaultValue: 'Definition Step ID',
                })}
              </div>
              <div className="font-mono text-xs text-gray-700">{selectedStep.definition_step_id}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">
                {t('runDetails.stepDetails.nextRetryLabel', { defaultValue: 'Next Retry' })}
              </div>
              <div className="text-gray-800">
                {formatDateTime(retryWaitsByStep.get(selectedStep.step_path)?.timeout_at ?? null)}
              </div>
            </div>
          </div>

          {selectedStepError && (
            <Card className="p-3 border border-destructive/30 bg-destructive/10">
              <div className="text-xs font-semibold text-destructive">
                {t('runDetails.stepDetails.errorTitle', { defaultValue: 'Error' })}
              </div>
              <div className="text-sm text-destructive">
                {String(selectedStepError.message
                  ?? t('runDetails.stepDetails.stepErrorFallback', { defaultValue: 'Step error' }))}
              </div>
              <div className="text-xs text-destructive/80">
                {selectedStepError.category
                  ?? t('runDetails.stepDetails.errorCategoryFallback', { defaultValue: 'Error' })} · {formatDateTime(selectedStepError.at ?? null)}
              </div>
            </Card>
          )}

          {stepWaits.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700">
                {t('runDetails.waitHistory.title', { defaultValue: 'Wait History' })}
              </div>
              <div className="mt-2 space-y-2">
                {stepWaits.map((wait) => (
                  <Card key={wait.wait_id} className="p-3">
                    {(() => {
                      const waitPayload = (wait.payload as { filters?: unknown[]; mode?: string; dueAt?: string | null } | null | undefined) ?? null;
                      const eventFilterCount = Array.isArray(waitPayload?.filters) ? waitPayload!.filters!.length : 0;
                      const isTimeWait = wait.wait_type === 'time';
                      return (
                        <>
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-gray-700">
                        {wait.wait_type.toUpperCase()} · {formatWorkflowStepStatus(wait.status)}
                      </div>
                      <div className="text-xs text-gray-500">{formatDateTime(wait.created_at)}</div>
                    </div>
                    {!isTimeWait && (
                      <div className="text-xs text-gray-500 mt-1">
                        {t('runDetails.waitHistory.eventLine', {
                          defaultValue: 'Event: {{event}} · Key: {{key}} · Filters: {{count}}',
                          event: wait.event_name ?? emptyValueLabel,
                          key: wait.key ?? emptyValueLabel,
                          count: eventFilterCount,
                        })}
                      </div>
                    )}
                    {isTimeWait && (
                      <div className="text-xs text-gray-500 mt-1">
                        {t('runDetails.waitHistory.timeLine', {
                          defaultValue: 'Mode: {{mode}} · Scheduled resume: {{scheduledResume}}',
                          mode: waitPayload?.mode ?? emptyValueLabel,
                          scheduledResume: formatDateTime(wait.timeout_at ?? waitPayload?.dueAt ?? null),
                        })}
                      </div>
                    )}
                    <div className="text-xs text-gray-500">
                      {t('runDetails.waitHistory.timeoutLine', {
                        defaultValue: 'Timeout: {{timeout}} · Resolved: {{resolved}}',
                        timeout: formatDateTime(wait.timeout_at),
                        resolved: formatDateTime(wait.resolved_at),
                      })}
                    </div>
                        </>
                      );
                    })()}
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-sm font-medium text-gray-700">
              {t('runDetails.envelope.title', { defaultValue: 'Envelope Data' })}
            </div>
            <div className="text-xs text-gray-500">
              {t('runDetails.envelope.description', {
                defaultValue: 'Payload, vars, meta, and error from the latest snapshot.',
              })}
            </div>
            {hasRedactions && (
              <div className="text-xs text-amber-600 mt-1">
                {t('runDetails.envelope.redactedNotice', {
                  defaultValue: 'Redacted values shown as {{marker}}.',
                  marker: REDACTION_MARKER,
                })}
              </div>
            )}
            <Tabs value={envelopeTab} onValueChange={setEnvelopeTab} className="mt-2">
              <TabsList className="mb-2">
                <TabsTrigger value="payload">{t('runDetails.envelope.tabs.payload', { defaultValue: 'Payload' })}</TabsTrigger>
                <TabsTrigger value="vars">{t('runDetails.envelope.tabs.vars', { defaultValue: 'Vars' })}</TabsTrigger>
                <TabsTrigger value="meta">{t('runDetails.envelope.tabs.meta', { defaultValue: 'Meta' })}</TabsTrigger>
                <TabsTrigger value="error">{t('runDetails.envelope.tabs.error', { defaultValue: 'Error' })}</TabsTrigger>
                <TabsTrigger value="raw">{t('runDetails.envelope.tabs.raw', { defaultValue: 'Raw' })}</TabsTrigger>
              </TabsList>
              <TabsContent value="payload">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopePayload) : noSnapshotLabel}
                </pre>
              </TabsContent>
              <TabsContent value="vars">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopeVars) : noSnapshotLabel}
                </pre>
              </TabsContent>
              <TabsContent value="meta">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopeMeta) : noSnapshotLabel}
                </pre>
              </TabsContent>
              <TabsContent value="error">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(envelopeError) : noSnapshotLabel}
                </pre>
              </TabsContent>
              <TabsContent value="raw">
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-3">
                  {redactedSnapshot ? renderJson(redactedSnapshot) : noSnapshotLabel}
                </pre>
              </TabsContent>
            </Tabs>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700">
              {t('runDetails.invocations.title', { defaultValue: 'Action Invocations' })}
            </div>
            {hasRedactions && (
              <div className="text-xs text-amber-600 mt-1">
                {t('runDetails.invocations.redactedNotice', {
                  defaultValue: 'Redacted values shown as {{marker}}.',
                  marker: REDACTION_MARKER,
                })}
              </div>
            )}
            {stepInvocations.length === 0 && (
              <div className="text-xs text-gray-500 mt-2">{noActionCallsLabel}</div>
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
                      {formatWorkflowStepStatus(invocation.status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-500">
                    {t('runDetails.invocations.attemptLine', {
                      defaultValue: 'Attempt {{count}}',
                      count: invocation.attempt,
                    })}
                  </div>
                  <div className="text-xs text-gray-500">
                    {t('runDetails.invocations.durationLine', {
                      defaultValue: 'Duration: {{duration}}',
                      duration: formatDuration(invocation.started_at, invocation.completed_at),
                    })}
                  </div>
                  {invocation.error_message && (
                    <div className="text-xs text-destructive mt-1">{invocation.error_message}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    {t('runDetails.invocations.sizeLine', {
                      defaultValue: 'Input size: {{inputSize}}{{inputSuffix}} · Output size: {{outputSize}}{{outputSuffix}}',
                      inputSize: formatBytes(inputSize),
                      inputSuffix: inputPreview.truncated
                        ? t('runDetails.invocations.truncatedSuffix', { defaultValue: ' (truncated)' })
                        : '',
                      outputSize: formatBytes(outputSize),
                      outputSuffix: outputPreview.truncated
                        ? t('runDetails.invocations.truncatedSuffix', { defaultValue: ' (truncated)' })
                        : '',
                    })}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <div className="text-xs font-semibold text-gray-500">
                        {t('runDetails.invocations.inputLabel', { defaultValue: 'Input' })}
                      </div>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-2">
                        {invocation.input_json ? inputPreview.preview : emptyValueLabel}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500">
                        {t('runDetails.invocations.outputLabel', { defaultValue: 'Output' })}
                      </div>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-900 text-gray-100 text-xs p-2">
                        {invocation.output_json ? outputPreview.preview : emptyValueLabel}
                      </pre>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700">
              {t('runDetails.logs.title', { defaultValue: 'Run Logs' })}
            </div>
            <div className="text-xs text-gray-500">
              {t('runDetails.logs.description', {
                defaultValue: 'Operational log events for this run.',
              })}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Input
                id="workflow-run-logs-search"
                label={t('runDetails.logs.searchLabel', { defaultValue: 'Search' })}
                value={logFilters.search}
                onChange={(event) => setLogFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder={t('runDetails.logs.searchPlaceholder', {
                  defaultValue: 'Search log message',
                })}
              />
              <CustomSelect
                id="workflow-run-logs-level"
                label={t('runDetails.logs.levelLabel', { defaultValue: 'Level' })}
                options={logLevelOptions}
                value={logFilters.level}
                onValueChange={(value) => setLogFilters((prev) => ({ ...prev, level: value }))}
              />
              <div className="flex items-end gap-2">
                <Button id="workflow-run-logs-apply" onClick={handleApplyLogFilters} disabled={logLoading}>
                  {t('runDetails.actions.apply', { defaultValue: 'Apply' })}
                </Button>
                <Button
                  id="workflow-run-logs-reset"
                  variant="outline"
                  onClick={handleResetLogFilters}
                  disabled={logLoading}
                >
                  {t('runDetails.actions.reset', { defaultValue: 'Reset' })}
                </Button>
                <Button
                  id="workflow-run-logs-export"
                  variant="outline"
                  onClick={handleLogExport}
                >
                  {t('runDetails.actions.exportCsv', { defaultValue: 'Export CSV' })}
                </Button>
              </div>
            </div>
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('runDetails.logs.columns.timestamp', { defaultValue: 'Timestamp' })}</TableHead>
                    <TableHead>{t('runDetails.logs.columns.level', { defaultValue: 'Level' })}</TableHead>
                    <TableHead>{t('runDetails.logs.columns.message', { defaultValue: 'Message' })}</TableHead>
                    <TableHead>{t('runDetails.logs.columns.step', { defaultValue: 'Step' })}</TableHead>
                    <TableHead>{t('runDetails.logs.columns.event', { defaultValue: 'Event' })}</TableHead>
                    <TableHead>{t('runDetails.logs.columns.correlation', { defaultValue: 'Correlation' })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.log_id}>
                      <TableCell className="text-xs text-gray-500">{formatDateTime(log.created_at)}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_STYLES[log.level] ?? 'bg-gray-100 text-gray-600'}>
                          {formatWorkflowLogLevel(log.level)}
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
                      <TableCell className="text-xs text-gray-500">{log.step_path ?? emptyValueLabel}</TableCell>
                      <TableCell className="text-xs text-gray-500">{log.event_name ?? emptyValueLabel}</TableCell>
                      <TableCell className="text-xs text-gray-500">{log.correlation_key ?? emptyValueLabel}</TableCell>
                    </TableRow>
                  ))}
                  {!logLoading && logs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-gray-500 py-6">
                        {noLogEntriesLabel}
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
                    {t('runDetails.actions.loadMore', { defaultValue: 'Load more' })}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {canAdmin && (
            <div>
              <div className="text-sm font-medium text-gray-700">
                {t('runDetails.audit.title', { defaultValue: 'Audit Trail' })}
              </div>
              <div className="text-xs text-gray-500">
                {t('runDetails.audit.description', {
                  defaultValue: 'Administrative actions for this run.',
                })}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Button
                  id="workflow-run-audit-export"
                  variant="outline"
                  onClick={handleAuditExport}
                >
                  {t('runDetails.actions.exportAuditCsv', { defaultValue: 'Export Audit CSV' })}
                </Button>
              </div>
              <div className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('runDetails.audit.columns.timestamp', { defaultValue: 'Timestamp' })}</TableHead>
                      <TableHead>{t('runDetails.audit.columns.operation', { defaultValue: 'Operation' })}</TableHead>
                      <TableHead>{t('runDetails.audit.columns.user', { defaultValue: 'User' })}</TableHead>
                      <TableHead>{t('runDetails.audit.columns.details', { defaultValue: 'Details' })}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.map((log) => (
                      <TableRow key={log.audit_id}>
                        <TableCell className="text-xs text-gray-500">{formatDateTime(log.timestamp)}</TableCell>
                        <TableCell className="text-xs text-gray-700">{log.operation}</TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {log.user_id ?? t('runDetails.audit.systemUser', { defaultValue: 'system' })}
                        </TableCell>
                        <TableCell>
                          {log.details ? (
                            <pre className="max-h-24 overflow-auto rounded bg-gray-900 text-gray-100 text-xs p-2">
                              {truncateJsonPreview(log.details, 2000).preview}
                            </pre>
                          ) : emptyValueLabel}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!auditLoading && auditLogs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-gray-500 py-6">
                          {noAuditEntriesLabel}
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
                      {t('runDetails.actions.loadMore', { defaultValue: 'Load more' })}
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
        title={t('runDetails.dialogs.resumeTitle', { defaultValue: 'Resume Workflow Run' })}
        message={(
          <div className="space-y-3">
            <p>{t('runDetails.dialogs.resumeMessage', { defaultValue: 'Resume this workflow run now?' })}</p>
            <TextArea
              id="workflow-run-resume-reason"
              label={reasonLabel}
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder={t('runDetails.dialogs.resumeReasonPlaceholder', {
                defaultValue: 'Provide a reason for resuming',
              })}
            />
          </div>
        )}
        confirmLabel={t('runDetails.actions.resume', { defaultValue: 'Resume' })}
        onConfirm={handleResume}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-cancel-confirm"
        isOpen={confirmAction === 'cancel'}
        title={t('runDetails.dialogs.cancelTitle', { defaultValue: 'Cancel Workflow Run' })}
        message={(
          <div className="space-y-3">
            <p>
              {t('runDetails.dialogs.cancelMessage', {
                defaultValue: 'Cancel this workflow run? This cannot be undone.',
              })}
            </p>
            <TextArea
              id="workflow-run-cancel-reason"
              label={reasonLabel}
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder={t('runDetails.dialogs.cancelReasonPlaceholder', {
                defaultValue: 'Provide a reason for canceling',
              })}
            />
          </div>
        )}
        confirmLabel={t('runDetails.dialogs.cancelConfirm', { defaultValue: 'Cancel run' })}
        onConfirm={handleCancel}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-retry-confirm"
        isOpen={confirmAction === 'retry'}
        title={t('runDetails.dialogs.retryTitle', { defaultValue: 'Retry Workflow Run' })}
        message={(
          <div className="space-y-3">
            <p>
              {t('runDetails.dialogs.retryMessage', {
                defaultValue: 'Retry this run from the last failed step?',
              })}
            </p>
            <TextArea
              id="workflow-run-retry-reason"
              label={reasonLabel}
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder={t('runDetails.dialogs.retryReasonPlaceholder', {
                defaultValue: 'Provide a reason for retrying',
              })}
            />
          </div>
        )}
        confirmLabel={t('runDetails.dialogs.retryConfirm', { defaultValue: 'Retry run' })}
        onConfirm={handleRetry}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-replay-confirm"
        isOpen={confirmAction === 'replay'}
        title={t('runDetails.dialogs.replayTitle', { defaultValue: 'Replay Workflow Run' })}
        message={(
          <div className="space-y-3">
            <p>
              {t('runDetails.dialogs.replayMessage', {
                defaultValue: 'Replay this run with a new payload.',
              })}
            </p>
            <TextArea
              id="workflow-run-replay-reason"
              label={reasonLabel}
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder={t('runDetails.dialogs.replayReasonPlaceholder', {
                defaultValue: 'Provide a reason for replaying',
              })}
            />
            <TextArea
              id="workflow-run-replay-payload"
              label={t('runDetails.dialogs.payloadLabel', { defaultValue: 'Payload (JSON)' })}
              value={replayPayload}
              onChange={(event) => setReplayPayload(event.target.value)}
              placeholder={'{"example": true}'}
              className="font-mono text-xs"
              rows={6}
            />
          </div>
        )}
        confirmLabel={t('runDetails.dialogs.replayConfirm', { defaultValue: 'Replay run' })}
        onConfirm={handleReplay}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmationDialog
        id="workflow-run-requeue-confirm"
        isOpen={confirmAction === 'requeue'}
        title={t('runDetails.dialogs.requeueTitle', { defaultValue: 'Requeue Event Wait' })}
        message={(
          <div className="space-y-3">
            <p>
              {t('runDetails.dialogs.requeueMessage', {
                defaultValue: 'Requeue the most recent event wait for this run?',
              })}
            </p>
            <TextArea
              id="workflow-run-requeue-reason"
              label={reasonLabel}
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder={t('runDetails.dialogs.requeueReasonPlaceholder', {
                defaultValue: 'Provide a reason for requeuing',
              })}
            />
          </div>
        )}
        confirmLabel={t('runDetails.dialogs.requeueConfirm', { defaultValue: 'Requeue wait' })}
        onConfirm={handleRequeue}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
};

export default WorkflowRunDetails;
