'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getWorkflowRunAction,
  getWorkflowDefinitionVersionAction,
  getWorkflowRunSummaryMetadataAction,
  listWorkflowRunsAction,
  listWorkflowRunLogsAction,
  listWorkflowRunStepsAction,
  listWorkflowRunTimelineEventsAction,
  cancelWorkflowRunAction,
  replayWorkflowRunAction
} from '@/lib/actions/workflow-runtime-v2-actions';
import { getCurrentUserPermissions } from '@alga-psa/users/actions';
import WorkflowGraph from '../workflow-graph/WorkflowGraph';
import type { WorkflowDefinition, Step } from '@shared/workflow/runtime';
import type { IfBlock, ForEachBlock, TryCatchBlock, NodeStep } from '@shared/workflow/runtime';
import {
  PipelineStart,
  PipelineConnector,
  getStepTypeColor,
  getStepTypeIcon
} from '../workflow-designer/pipeline/PipelineComponents';

type WorkflowRunRecord = {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  tenant_id?: string | null;
  status: string;
  node_path?: string | null;
  event_type?: string | null;
  input_json?: Record<string, unknown> | null;
  resume_event_name?: string | null;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
};

type WorkflowRunSummary = {
  workflow_name?: string | null;
};

type WorkflowRunStepRecord = {
  step_id: string;
  run_id: string;
  step_path: string;
  definition_step_id: string;
  status: string;
  attempt: number;
  duration_ms?: number | null;
  started_at: string;
  completed_at?: string | null;
};

type WorkflowRunLogRecord = {
  log_id: string;
  level: string;
  message: string;
  step_path?: string | null;
  created_at: string;
};

type WorkflowRunSnapshotRecord = {
  snapshot_id: string;
  run_id: string;
  step_path: string;
  envelope_json: Record<string, unknown>;
  size_bytes: number;
  created_at: string;
};

type WorkflowActionInvocationRecord = {
  invocation_id: string;
  run_id: string;
  step_path: string;
  action_id: string;
  action_version: number;
  idempotency_key: string;
  status: string;
  attempt: number;
  input_json?: Record<string, unknown> | null;
  output_json?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

type WorkflowRunSummaryMetadata = {
  runId: string;
  status: string;
  workflowId: string;
  workflowVersion: number;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  stepsCount: number;
  logsCount: number;
  waitsCount: number;
};

type WorkflowRunTimelineEvent =
  | {
      type: 'step';
      step_id: string;
      step_path: string;
      definition_step_id: string;
      status: string;
      attempt: number;
      duration_ms?: number | null;
      started_at: string;
      completed_at?: string | null;
      timestamp: string;
    }
  | {
      type: 'wait';
      wait_id: string;
      step_path: string;
      wait_type: string;
      status: string;
      event_name?: string | null;
      key?: string | null;
      timeout_at?: string | null;
      created_at: string;
      resolved_at?: string | null;
      timestamp: string;
    };

type RunStudioShellProps = {
  runId: string;
};

const statusBadgeClasses: Record<string, string> = {
  RUNNING: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  WAITING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  SUCCEEDED: 'bg-green-100 text-green-800 border-green-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  CANCELED: 'bg-gray-100 text-gray-700 border-gray-200'
};

const RunStudioShell: React.FC<RunStudioShellProps> = ({ runId }) => {
  const [run, setRun] = useState<WorkflowRunRecord | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [runSummary, setRunSummary] = useState<WorkflowRunSummary | null>(null);
  const [summaryMetadata, setSummaryMetadata] = useState<WorkflowRunSummaryMetadata | null>(null);
  const [steps, setSteps] = useState<WorkflowRunStepRecord[]>([]);
  const [logs, setLogs] = useState<WorkflowRunLogRecord[]>([]);
  const [snapshots, setSnapshots] = useState<WorkflowRunSnapshotRecord[]>([]);
  const [invocations, setInvocations] = useState<WorkflowActionInvocationRecord[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<WorkflowRunTimelineEvent[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [runActionMode, setRunActionMode] = useState<'cancel' | 'replay' | null>(null);
  const [runActionReason, setRunActionReason] = useState('');
  const [replayPayloadText, setReplayPayloadText] = useState('');
  const [replayPayloadError, setReplayPayloadError] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logLevelFilters, setLogLevelFilters] = useState<string[]>([]);
  const [timelineSearch, setTimelineSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [pipelineViewMode, setPipelineViewMode] = useState<'graph' | 'list'>('graph');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('workflow-run-studio:pipeline-view');
      if (stored === 'graph' || stored === 'list') {
        setPipelineViewMode(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('workflow-run-studio:pipeline-view', pipelineViewMode);
    } catch {}
  }, [pipelineViewMode]);

  const fetchRun = async () => {
    setLoading(true);
    try {
      const data = await getWorkflowRunAction({ runId });
      setRun(data as WorkflowRunRecord);
      try {
        const runResult = await listWorkflowRunsAction({ runId, limit: 1, cursor: 0 });
        setRunSummary((runResult?.runs?.[0] ?? null) as WorkflowRunSummary | null);
      } catch {
        setRunSummary(null);
      }
      if (data?.workflow_id && data?.workflow_version) {
        const version = await getWorkflowDefinitionVersionAction({
          workflowId: data.workflow_id,
          version: data.workflow_version
        });
        setDefinition((version?.definition_json ?? null) as WorkflowDefinition | null);
      }
      try {
        const summary = await getWorkflowRunSummaryMetadataAction({ runId });
        setSummaryMetadata(summary as WorkflowRunSummaryMetadata);
      } catch {
        setSummaryMetadata(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchStepsAndLogs = async () => {
    try {
      const stepResult = await listWorkflowRunStepsAction({ runId });
      setSteps(stepResult.steps ?? []);
      setSnapshots(stepResult.snapshots ?? []);
      setInvocations(stepResult.invocations ?? []);
      const timelineResult = await listWorkflowRunTimelineEventsAction({ runId });
      setTimelineEvents((timelineResult as { events?: WorkflowRunTimelineEvent[] } | null)?.events ?? []);
      const logResult = await listWorkflowRunLogsAction({ runId, limit: 200, cursor: 0 });
      setLogs(logResult.logs ?? []);
      setLastUpdatedAt(new Date());
    } catch {
      // ignore for now
    }
  };

  useEffect(() => {
    fetchRun();
    fetchStepsAndLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    getCurrentUserPermissions()
      .then((perms) => setUserPermissions(perms ?? []))
      .catch(() => setUserPermissions([]));
  }, []);

  useEffect(() => {
    if (!run) return;
    const shouldPoll = run.status === 'RUNNING' || run.status === 'WAITING';
    if (!shouldPoll) return;
    setPolling(true);
    const interval = setInterval(() => {
      fetchRun();
      fetchStepsAndLogs();
    }, 4000);
    return () => {
      clearInterval(interval);
      setPolling(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, runId]);

  useEffect(() => {
    if (!run || (run.status !== 'RUNNING' && run.status !== 'WAITING')) return;
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, [run?.status]);

  const status = run?.status ?? 'UNKNOWN';
  const badgeClass = statusBadgeClasses[status] ?? 'bg-gray-100 text-gray-700 border-gray-200';

  const stepStatusMap = useMemo(() => {
    const map = new Map<string, WorkflowRunStepRecord>();
    for (const step of steps) {
      const existing = map.get(step.definition_step_id);
      if (!existing) {
        map.set(step.definition_step_id, step);
        continue;
      }
      if (new Date(step.started_at).getTime() > new Date(existing.started_at).getTime()) {
        map.set(step.definition_step_id, step);
      }
    }
    return map;
  }, [steps]);

  const stepStatusById = useMemo(() => {
    const map = new Map<string, string>();
    stepStatusMap.forEach((record, stepId) => {
      map.set(stepId, record.status);
    });
    return map;
  }, [stepStatusMap]);

  const orderedSteps = useMemo(() => {
    if (!definition?.steps) return [] as Step[];
    return definition.steps as Step[];
  }, [definition]);

  const definitionStepMap = useMemo(() => {
    const map = new Map<string, Step>();
    for (const step of orderedSteps) {
      map.set(step.id, step);
    }
    return map;
  }, [orderedSteps]);

  const getStepLabel = (step: Step): string => {
    if (step.type === 'action.call') {
      const config = (step as NodeStep).config as { actionId?: string } | undefined;
      return config?.actionId ? `Action: ${config.actionId}` : step.id;
    }
    if (step.type === 'control.if') return 'If Condition';
    if (step.type === 'control.forEach') return 'For Each';
    if (step.type === 'control.tryCatch') return 'Try/Catch';
    if (step.type === 'event.wait') return 'Wait for Event';
    if (step.type === 'human.task') return 'Human Task';
    if (step.type === 'state.set') return 'Set State';
    if (step.type === 'transform.assign') return 'Assign';
    return step.id;
  };

  const stepPathMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const step of steps) {
      const existing = map.get(step.definition_step_id);
      if (!existing) {
        map.set(step.definition_step_id, step.step_path);
        continue;
      }
      const prev = steps.find((item) => item.step_path === existing);
      if (!prev) {
        map.set(step.definition_step_id, step.step_path);
        continue;
      }
      if (new Date(step.started_at).getTime() > new Date(prev.started_at).getTime()) {
        map.set(step.definition_step_id, step.step_path);
      }
    }
    return map;
  }, [steps]);

  const stepPathToDefinitionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const step of steps) {
      if (!map.has(step.step_path)) {
        map.set(step.step_path, step.definition_step_id);
      }
    }
    return map;
  }, [steps]);

  const selectedStep = useMemo(() => {
    if (!selectedStepId || !definition?.steps) return null;
    return (definition.steps as Step[]).find((step) => step.id === selectedStepId) ?? null;
  }, [definition?.steps, selectedStepId]);

  const selectedStepPath = selectedStepId ? stepPathMap.get(selectedStepId) ?? null : null;

  const selectedSnapshot = useMemo(() => {
    if (!selectedStepPath) return null;
    const matching = snapshots.filter((snapshot) => snapshot.step_path === selectedStepPath);
    return matching.length ? matching[matching.length - 1] : null;
  }, [snapshots, selectedStepPath]);

  const selectedInvocation = useMemo(() => {
    if (!selectedStepPath) return null;
    const matching = invocations.filter((invocation) => invocation.step_path === selectedStepPath);
    return matching.length ? matching[matching.length - 1] : null;
  }, [invocations, selectedStepPath]);

  const timelineEntries = useMemo(() => {
    const search = timelineSearch.trim().toLowerCase();
    const stepGroups = new Map<string, WorkflowRunTimelineEvent[]>();
    const waitEntries = [] as Array<{
      kind: 'wait';
      stepPath: string;
      stepId: string | null;
      waitType: string;
      status: string;
      createdAt: string;
      resolvedAt?: string | null;
      eventName?: string | null;
      key?: string | null;
    }>;

    timelineEvents.forEach((event) => {
      if (event.type === 'wait') {
        waitEntries.push({
          kind: 'wait',
          stepPath: event.step_path,
          stepId: stepPathToDefinitionId.get(event.step_path) ?? null,
          waitType: event.wait_type,
          status: event.status,
          createdAt: event.created_at,
          resolvedAt: event.resolved_at ?? null,
          eventName: event.event_name ?? null,
          key: event.key ?? null
        });
        return;
      }
      if (!stepGroups.has(event.step_path)) {
        stepGroups.set(event.step_path, []);
      }
      stepGroups.get(event.step_path)!.push(event);
    });

    const stepEntries = Array.from(stepGroups.entries()).map(([stepPath, attempts]) => {
      const sorted = [...attempts].sort((a, b) => (a as any).attempt - (b as any).attempt);
      const first = sorted[0] as Extract<WorkflowRunTimelineEvent, { type: 'step' }>;
      const last = sorted[sorted.length - 1] as Extract<WorkflowRunTimelineEvent, { type: 'step' }>;
      const stepId = first.definition_step_id ?? stepPathToDefinitionId.get(stepPath) ?? null;
      const label = stepId && definitionStepMap.get(stepId)
        ? getStepLabel(definitionStepMap.get(stepId) as Step)
        : stepPath;
      return {
        kind: 'step' as const,
        stepPath,
        stepId,
        label,
        status: last.status,
        startedAt: first.started_at,
        attempts: sorted as Extract<WorkflowRunTimelineEvent, { type: 'step' }>[]
      };
    });

    const combined = [...stepEntries, ...waitEntries].sort((a, b) => {
      const aTime = a.kind === 'step' ? new Date(a.startedAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.kind === 'step' ? new Date(b.startedAt).getTime() : new Date(b.createdAt).getTime();
      return aTime - bTime;
    });

    if (!search) return combined;
    return combined.filter((entry) => {
      if (entry.kind === 'step') {
        const haystack = `${entry.stepPath} ${entry.status}`.toLowerCase();
        return haystack.includes(search);
      }
      const haystack = `${entry.stepPath} ${entry.waitType} ${entry.status} ${entry.eventName ?? ''} ${entry.key ?? ''}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [definitionStepMap, stepPathToDefinitionId, timelineEvents, timelineSearch]);

  const getStepStatusStyle = (record?: WorkflowRunStepRecord) => {
    if (!record) {
      return {
        badge: { label: 'Pending', className: 'bg-gray-100 text-gray-600 border-gray-200' },
        card: 'border-gray-200',
        pulse: false,
        stripe: false,
        timestamp: null
      };
    }
    const timestamp = record.completed_at ?? record.started_at;
    switch (record.status) {
      case 'STARTED':
        return {
          badge: { label: 'Running', className: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
          card: 'border-cyan-200 ring-2 ring-cyan-200',
          pulse: true,
          stripe: false,
          timestamp
        };
      case 'SUCCEEDED':
        return {
          badge: { label: 'Succeeded', className: 'bg-green-100 text-green-800 border-green-200' },
          card: 'border-green-200 ring-1 ring-green-200',
          pulse: false,
          stripe: false,
          timestamp
        };
      case 'FAILED':
        return {
          badge: { label: 'Failed', className: 'bg-red-100 text-red-800 border-red-200' },
          card: 'border-red-200 ring-2 ring-red-200',
          pulse: false,
          stripe: false,
          timestamp
        };
      case 'RETRY_SCHEDULED':
        return {
          badge: { label: 'Retrying', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
          card: 'border-yellow-200 ring-1 ring-yellow-200',
          pulse: false,
          stripe: true,
          timestamp
        };
      case 'CANCELED':
        return {
          badge: { label: 'Canceled', className: 'bg-gray-100 text-gray-700 border-gray-200' },
          card: 'border-gray-200',
          pulse: false,
          stripe: false,
          timestamp
        };
      default:
        return {
          badge: { label: record.status, className: 'bg-gray-100 text-gray-700 border-gray-200' },
          card: 'border-gray-200',
          pulse: false,
          stripe: false,
          timestamp
        };
    }
  };

  const renderPipe = (pipeSteps: Step[], pipePath: string, isRoot: boolean) => {
    return (
      <div data-pipe-path={pipePath} className="flex flex-col items-stretch">
        {isRoot && pipeSteps.length > 0 && (
          <div className="flex flex-col items-center mb-2">
            <PipelineStart />
            <PipelineConnector position="start" />
          </div>
        )}
        {pipeSteps.length === 0 && (
          <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
            No steps in this branch.
          </div>
        )}
        {pipeSteps.map((step, index) => (
          <React.Fragment key={step.id}>
            {renderStepCard(step, `${pipePath}.steps[${index}]`)}
            {index < pipeSteps.length - 1 && (
              <div className="flex justify-center">
                <PipelineConnector position="middle" />
              </div>
            )}
          </React.Fragment>
        ))}
        {pipeSteps.length > 0 && (
          <div className="flex justify-center">
            <PipelineConnector position="end" />
          </div>
        )}
      </div>
    );
  };

  const renderStepCard = (step: Step, stepPath: string) => {
    const colors = getStepTypeColor(step.type);
    const icon = getStepTypeIcon(step.type);
    const record = stepStatusMap.get(step.id);
    const statusInfo = getStepStatusStyle(record);
    const timestampLabel = statusInfo.timestamp ? new Date(statusInfo.timestamp).toLocaleString() : 'Pending';
    const title = `Last status: ${statusInfo.badge.label} (${timestampLabel})`;
    const isSelected = selectedStepId === step.id;

    const stripeStyle = statusInfo.stripe
      ? {
        backgroundImage:
          'repeating-linear-gradient(135deg, rgba(252, 211, 77, 0.25), rgba(252, 211, 77, 0.25) 6px, transparent 6px, transparent 12px)'
      }
      : undefined;

    return (
      <Card
        key={step.id}
        title={title}
        style={stripeStyle}
        className={`p-3 border-l-4 ${colors.border} border-r border-t border-b ${statusInfo.card} ${
          statusInfo.pulse ? 'animate-pulse' : ''
        } ${isSelected ? 'ring-2 ring-primary-300' : ''} transition-all cursor-pointer`}
        data-testid={`run-step-card-${step.id}`}
        onClick={() => setSelectedStepId(step.id)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className={`flex-shrink-0 ${colors.icon}`}>{icon}</div>
              <span className="text-sm font-medium text-gray-900 truncate">{getStepLabel(step)}</span>
              {step.type.startsWith('control.') && (
                <Badge className={`text-xs ${colors.badge}`}>
                  {step.type === 'control.if' ? 'If' : step.type === 'control.forEach' ? 'Loop' : step.type === 'control.tryCatch' ? 'Try' : 'Block'}
                </Badge>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">{step.type}</div>
          </div>
          <div className="flex items-center gap-2">
            {record?.attempt && record.attempt > 1 && (
              <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs">Attempt {record.attempt}</Badge>
            )}
            <Badge className={statusInfo.badge.className}>{statusInfo.badge.label}</Badge>
          </div>
        </div>

        {step.type === 'control.if' && (() => {
          const ifStep = step as IfBlock;
          const thenPath = `${stepPath}.then`;
          const elsePath = `${stepPath}.else`;
          return (
            <div className="mt-3 space-y-2">
              <RunBlockSection title="THEN">
                {renderPipe(ifStep.then, thenPath, false)}
              </RunBlockSection>
              <RunBlockSection title="ELSE">
                {renderPipe(ifStep.else ?? [], elsePath, false)}
              </RunBlockSection>
            </div>
          );
        })()}

        {step.type === 'control.tryCatch' && (() => {
          const tcStep = step as TryCatchBlock;
          const tryPath = `${stepPath}.try`;
          const catchPath = `${stepPath}.catch`;
          return (
            <div className="mt-3 space-y-2">
              <RunBlockSection title="TRY">
                {renderPipe(tcStep.try, tryPath, false)}
              </RunBlockSection>
              <RunBlockSection title="CATCH">
                {renderPipe(tcStep.catch, catchPath, false)}
              </RunBlockSection>
            </div>
          );
        })()}

        {step.type === 'control.forEach' && (() => {
          const feStep = step as ForEachBlock;
          const bodyPath = `${stepPath}.body`;
          return (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-2">Item: {feStep.itemVar} | Concurrency: {feStep.concurrency ?? 1}</div>
              <RunBlockSection title="BODY">
                {renderPipe(feStep.body, bodyPath, false)}
              </RunBlockSection>
            </div>
          );
        })()}
      </Card>
    );
  };

  const durationMs = run
    ? new Date(run.completed_at ?? now).getTime() - new Date(run.started_at).getTime()
    : null;
  const durationSeconds = durationMs != null ? Math.max(0, Math.floor(durationMs / 1000)) : null;

  const logLevelStyles: Record<string, string> = {
    ERROR: 'text-red-700 bg-red-50 border-red-100',
    WARN: 'text-yellow-700 bg-yellow-50 border-yellow-100',
    INFO: 'text-blue-700 bg-blue-50 border-blue-100',
    DEBUG: 'text-gray-600 bg-gray-50 border-gray-100'
  };

  const filteredLogs = useMemo(() => {
    const search = logSearch.trim().toLowerCase();
    return logs.filter((log) => {
      const level = (log.level || '').toUpperCase();
      if (logLevelFilters.length && !logLevelFilters.includes(level)) {
        return false;
      }
      if (!search) return true;
      const haystack = `${log.message ?? ''} ${log.step_path ?? ''}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [logs, logLevelFilters, logSearch]);

  const toggleLogLevel = (level: string) => {
    setLogLevelFilters((prev) => (
      prev.includes(level) ? prev.filter((item) => item !== level) : [...prev, level]
    ));
  };

  const canAdmin = useMemo(() => userPermissions.includes('workflow:admin'), [userPermissions]);
  const isRunFinished = run?.status ? ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(run.status) : false;
  const canCancel = canAdmin && run?.status && ['RUNNING', 'WAITING'].includes(run.status);
  const canReplay = canAdmin && run?.status && isRunFinished;
  const actionReasonValid = runActionReason.trim().length >= 3;
  const runError = (run as { error_json?: Record<string, unknown> | null; resume_event_name?: string | null; resume_event_payload?: Record<string, unknown> | null }) ?? {};

  const lastSucceededStep = useMemo(() => {
    const succeeded = steps.filter((step) => step.status === 'SUCCEEDED');
    if (!succeeded.length) return null;
    const last = succeeded.reduce((acc, current) => (
      new Date(current.started_at).getTime() > new Date(acc.started_at).getTime() ? current : acc
    ), succeeded[0]);
    const stepId = stepPathToDefinitionId.get(last.step_path) ?? null;
    const label = stepId && definitionStepMap.get(stepId)
      ? getStepLabel(definitionStepMap.get(stepId) as Step)
      : last.step_path;
    return { stepId, label, stepPath: last.step_path };
  }, [definitionStepMap, steps, stepPathToDefinitionId]);

  const openCancel = () => {
    setRunActionMode('cancel');
    setRunActionReason('');
  };

  const openReplay = () => {
    const payload = run?.input_json ?? {};
    setReplayPayloadText(JSON.stringify(payload, null, 2));
    setReplayPayloadError(null);
    setRunActionMode('replay');
    setRunActionReason('');
  };

  const handleReplayPayloadChange = (value: string) => {
    setReplayPayloadText(value);
    try {
      JSON.parse(value);
      setReplayPayloadError(null);
    } catch (err) {
      setReplayPayloadError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleRunActionConfirm = async () => {
    if (!runActionMode || !run) return;
    if (!actionReasonValid) {
      toast.error('Reason is required (min 3 characters).');
      return;
    }
    setIsSubmittingAction(true);
    try {
      if (runActionMode === 'cancel') {
        await cancelWorkflowRunAction({ runId: run.run_id, reason: runActionReason, source: 'run-studio' });
        toast.success('Run canceled.');
      } else {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(replayPayloadText || '{}');
        } catch (err) {
          setReplayPayloadError(err instanceof Error ? err.message : 'Invalid JSON');
          setIsSubmittingAction(false);
          return;
        }
        const result = await replayWorkflowRunAction({
          runId: run.run_id,
          reason: runActionReason,
          payload,
          source: 'run-studio'
        });
        const newRunId = (result as { runId?: string } | undefined)?.runId;
        if (newRunId) {
          window.location.assign(`/msp/workflows/runs/${newRunId}`);
          return;
        }
        toast.success('Run replay started.');
      }
      setRunActionMode(null);
      fetchRun();
      fetchStepsAndLogs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to perform action.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Run Studio</div>
          <h1 className="text-2xl font-semibold text-gray-900">{runSummary?.workflow_name ?? 'Workflow Run'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="font-mono">{runId}</span>
            {run?.workflow_version ? <span>Version {run.workflow_version}</span> : null}
            {lastUpdatedAt ? <span>Updated {lastUpdatedAt.toLocaleTimeString()}</span> : null}
          </div>
          <div className="mt-2 text-xs">
            <Link href="/msp/workflows" className="text-primary-600 hover:text-primary-700">
              ← Back to Workflows
            </Link>
          </div>
        </div>
	        <div className="flex items-center gap-2">
	          <Badge className={badgeClass}>{status}</Badge>
	          <Button id="workflow-run-replay" variant="outline" size="sm" onClick={openReplay} disabled={!canReplay}>
	            Replay
	          </Button>
	          <Button id="workflow-run-cancel" variant="outline" size="sm" onClick={openCancel} disabled={!canCancel}>
	            Cancel
	          </Button>
	          <Button
	            id="workflow-run-refresh"
	            variant="outline"
	            size="sm"
	            onClick={() => { fetchRun(); fetchStepsAndLogs(); }}
	            disabled={loading}
	          >
	            <RefreshCw className={`h-4 w-4 ${loading || polling ? 'animate-spin' : ''}`} />
	          </Button>
	        </div>
	      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <Card className="lg:col-span-2 p-4 flex flex-col min-h-[420px]">
          {run?.status === 'FAILED' && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <div className="font-semibold">Run failed</div>
              {lastSucceededStep && (
                <div className="mt-1 text-xs text-red-700">
                  Last successful step: {lastSucceededStep.label}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-800">Execution Pipeline</div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" />Running</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />Succeeded</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500" />Retrying</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />Failed</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-500" />Pending</span>
              </div>
	              <div className="flex items-center gap-2">
	                <Button
	                  id="workflow-run-pipeline-view-graph"
	                  variant={pipelineViewMode === 'graph' ? 'default' : 'outline'}
	                  size="sm"
	                  onClick={() => setPipelineViewMode('graph')}
	                >
	                  Graph
	                </Button>
	                <Button
	                  id="workflow-run-pipeline-view-list"
	                  variant={pipelineViewMode === 'list' ? 'default' : 'outline'}
	                  size="sm"
	                  onClick={() => setPipelineViewMode('list')}
	                >
	                  List
                </Button>
              </div>
            </div>
          </div>
          {pipelineViewMode === 'graph' ? (
            <div className="flex-1 overflow-hidden rounded border border-gray-200 bg-white">
              {orderedSteps.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-500">
                  {loading ? 'Loading workflow definition…' : 'No steps to display.'}
                </div>
              ) : (
                <WorkflowGraph
                  steps={orderedSteps}
                  getLabel={(step) => getStepLabel(step as Step)}
                  getSubtitle={(step) => (step as Step).type}
                  statusByStepId={stepStatusById}
                  selectedStepId={selectedStepId}
                  onSelectStepId={setSelectedStepId}
                  className="h-full"
                />
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-auto space-y-2">
              {orderedSteps.length === 0 && (
                <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
                  {loading ? 'Loading workflow definition...' : 'No steps to display.'}
                </div>
              )}
              {orderedSteps.length > 0 && renderPipe(orderedSteps, 'root', true)}
            </div>
          )}
        </Card>
        <Card className="p-4 flex flex-col min-h-[420px]">
          <div className="text-sm font-semibold text-gray-800 mb-2">Run Details</div>
          <div className="space-y-3 text-xs text-gray-600 mb-4">
            <div>
              <div className="text-[11px] uppercase text-gray-400">Run Id</div>
              <div className="font-mono text-gray-700">{runId}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] uppercase text-gray-400">Started</div>
                <div>{run?.started_at ? new Date(run.started_at).toLocaleString() : '-'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400">Duration</div>
                <div>{durationSeconds != null ? `${durationSeconds}s` : '-'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400">Tenant</div>
                <div className="font-mono">{run?.tenant_id ?? '-'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400">Trigger</div>
                <div>{definition?.trigger?.eventName ?? 'Manual'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400">Event Type</div>
                <div className="font-mono">{run?.event_type ?? '-'}</div>
              </div>
              {run?.status === 'WAITING' && (
                <div>
                  <div className="text-[11px] uppercase text-gray-400">Waiting For</div>
                  <div>{runError.resume_event_name ?? 'Resume event'}</div>
                </div>
              )}
              {summaryMetadata && (
                <div>
                  <div className="text-[11px] uppercase text-gray-400">Counts</div>
                  <div>{summaryMetadata.stepsCount} steps · {summaryMetadata.logsCount} logs · {summaryMetadata.waitsCount} waits</div>
                </div>
              )}
            </div>
          </div>

          {(runError.error_json || runError.resume_event_payload) && (
            <div className="space-y-3 mb-4">
              <div className="text-sm font-semibold text-gray-800">Run Errors</div>
              {runError.error_json && (
                <RunJsonPanel title="Run Error Payload" value={runError.error_json} />
              )}
              {runError.resume_event_payload && (
                <RunJsonPanel title="Resume Event Payload" value={runError.resume_event_payload} />
              )}
            </div>
          )}

          <div className="text-sm font-semibold text-gray-800 mb-2">Step Details</div>
          {!selectedStep && (
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 mb-4">
              Select a step in the pipeline to inspect inputs, outputs, and snapshots.
            </div>
          )}
          {selectedStep && (
            <div className="space-y-3 mb-4">
              <div className="text-xs text-gray-600">
                <div className="text-[11px] uppercase text-gray-400">Step</div>
                <div className="font-medium text-gray-800">{getStepLabel(selectedStep)}</div>
                <div className="text-[11px] text-gray-500">{selectedStep.type}</div>
                {selectedStepPath ? <div className="font-mono text-[11px] text-gray-500">{selectedStepPath}</div> : null}
              </div>
              <RunJsonPanel title="Step Configuration" value={selectedStep} />
              {selectedInvocation?.input_json && (
                <RunJsonPanel title="Input (Resolved)" value={selectedInvocation.input_json} />
              )}
              {selectedInvocation?.output_json && (
                <RunJsonPanel title="Output" value={selectedInvocation.output_json} />
              )}
              {selectedInvocation?.error_message && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {selectedInvocation.error_message}
                </div>
              )}
              {selectedSnapshot?.envelope_json && (
                <RunJsonPanel title="Envelope Snapshot" value={selectedSnapshot.envelope_json} />
              )}
            </div>
          )}

          <div className="text-sm font-semibold text-gray-800 mb-2">Execution Timeline</div>
          <div className="mb-2">
            <Input
              id="workflow-run-timeline-search"
              label="Search timeline"
              value={timelineSearch}
              onChange={(event) => setTimelineSearch(event.target.value)}
              placeholder="Search step path, wait type, status"
            />
          </div>
          <div className="mb-4 max-h-64 overflow-auto rounded border border-gray-200 bg-white">
            {timelineEntries.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No timeline entries yet.</div>
            )}
            {timelineEntries.map((entry, index) => (
              <div key={`${entry.kind}-${entry.stepPath}-${index}`} className="border-b border-gray-100 px-3 py-2 text-xs text-gray-700">
                {entry.kind === 'step' ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-gray-800">{entry.label}</div>
                        <div className="font-mono text-[10px] text-gray-400">{entry.stepPath}</div>
                      </div>
	                      {entry.stepId && (
	                        <Button
	                          id={`workflow-run-timeline-jump-${entry.stepId ?? index}`}
	                          variant="ghost"
	                          size="sm"
	                          onClick={() => setSelectedStepId(entry.stepId!)}
	                        >
	                          Jump
	                        </Button>
	                      )}
                    </div>
                    {entry.attempts.map((attempt) => {
                      const duration = attempt.completed_at
                        ? Math.max(0, new Date(attempt.completed_at).getTime() - new Date(attempt.started_at).getTime())
                        : null;
                      return (
                        <div key={`${entry.stepPath}-attempt-${attempt.attempt}`} className="flex items-center justify-between text-[11px] text-gray-500">
                          <span>Attempt {attempt.attempt} · {attempt.status}</span>
                          <span>{duration != null ? `${duration}ms` : 'In progress'}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-gray-800">Wait · {entry.waitType}</div>
                        <div className="font-mono text-[10px] text-gray-400">{entry.stepPath}</div>
                      </div>
	                      {entry.stepId && (
	                        <Button
	                          id={`workflow-run-timeline-jump-${entry.stepId ?? index}`}
	                          variant="ghost"
	                          size="sm"
	                          onClick={() => setSelectedStepId(entry.stepId!)}
	                        >
	                          Jump
	                        </Button>
	                      )}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Status: {entry.status}
                      {entry.eventName ? ` · Event: ${entry.eventName}` : ''}
                      {entry.key ? ` · Key: ${entry.key}` : ''}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Created: {new Date(entry.createdAt).toLocaleString()}
                      {entry.resolvedAt ? ` · Resolved: ${new Date(entry.resolvedAt).toLocaleString()}` : ''}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="text-sm font-semibold text-gray-800 mb-2">Run Logs</div>
          <div className="mb-2 space-y-2">
            <Input
              id="workflow-run-log-search"
              label="Search logs"
              value={logSearch}
              onChange={(event) => setLogSearch(event.target.value)}
              placeholder="Search message or step path"
            />
            <div className="flex flex-wrap gap-2">
	              {['ERROR', 'WARN', 'INFO', 'DEBUG'].map((level) => (
	                <Button
	                  key={level}
	                  id={`workflow-run-log-level-${level}`}
	                  variant={logLevelFilters.includes(level) ? 'default' : 'outline'}
	                  size="sm"
	                  onClick={() => toggleLogLevel(level)}
	                >
	                  {level}
	                </Button>
	              ))}
	              {logLevelFilters.length > 0 && (
	                <Button
	                  id="workflow-run-log-level-clear"
	                  variant="ghost"
	                  size="sm"
	                  onClick={() => setLogLevelFilters([])}
	                >
	                  Clear
	                </Button>
	              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto rounded border border-gray-200 bg-white">
            {filteredLogs.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No logs yet.</div>
            )}
            {filteredLogs.map((log) => (
              <div key={log.log_id} className="border-b border-gray-100 px-3 py-2 text-xs text-gray-700">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-gray-500">{new Date(log.created_at).toLocaleTimeString()}</span>
                  <span className={`text-[10px] uppercase tracking-wide border px-2 py-0.5 rounded ${logLevelStyles[(log.level || '').toUpperCase()] ?? 'text-gray-400 border-gray-200'}`}>
                    {log.level}
                  </span>
                </div>
                <div className="mt-1">{log.message}</div>
                {log.step_path && (
                  <div className="mt-1 font-mono text-[10px] text-gray-400">{log.step_path}</div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Dialog
        isOpen={runActionMode !== null}
        onClose={() => setRunActionMode(null)}
        title={runActionMode === 'cancel' ? 'Cancel Run' : 'Replay Run'}
        className="max-w-2xl"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{runActionMode === 'cancel' ? 'Cancel Workflow Run' : 'Replay Workflow Run'}</DialogTitle>
            <DialogDescription>
              {runActionMode === 'cancel'
                ? 'Canceling will stop any in-progress or waiting steps for this run.'
                : 'Replaying will start a new run using the payload below.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              id="workflow-run-action-reason"
              label="Reason"
              value={runActionReason}
              onChange={(event) => setRunActionReason(event.target.value)}
              placeholder="e.g. Canceling to adjust inputs"
            />

            {runActionMode === 'replay' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payload (JSON)</label>
                <TextArea
                  id="workflow-run-replay-payload"
                  value={replayPayloadText}
                  onChange={(event) => handleReplayPayloadChange(event.target.value)}
                  rows={10}
                  className={replayPayloadError ? 'border-red-500' : ''}
                />
                {replayPayloadError && (
                  <div className="text-xs text-red-600 mt-1">{replayPayloadError}</div>
                )}
              </div>
            )}
          </div>

	          <div className="mt-6 flex justify-end gap-2">
	            <Button id="workflow-run-action-close" variant="outline" onClick={() => setRunActionMode(null)}>
	              Close
	            </Button>
	            <Button
	              id="workflow-run-action-confirm"
	              onClick={handleRunActionConfirm}
	              disabled={!actionReasonValid || isSubmittingAction || (runActionMode === 'replay' && !!replayPayloadError)}
	            >
	              {isSubmittingAction ? 'Working...' : runActionMode === 'cancel' ? 'Confirm Cancel' : 'Start Replay'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const RunBlockSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="border border-gray-200 rounded-md bg-gray-50">
      <button
        className="flex items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase text-gray-600 w-full"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="text-xs">{isOpen ? '▾' : '▸'}</span>
        {title}
      </button>
      {isOpen && <div className="p-3">{children}</div>}
    </div>
  );
};

const RunJsonPanel: React.FC<{ title: string; value: unknown }> = ({ title, value }) => {
  const extracted = value as { message?: string; name?: string; errorType?: string; category?: string } | null;
  const summary = extracted
    ? [extracted.errorType, extracted.category, extracted.name].filter(Boolean).join(' · ')
    : null;
  let content = '';
  try {
    content = JSON.stringify(value ?? null, null, 2);
  } catch {
    content = 'Unable to serialize value.';
  }
  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-3 py-2 text-[11px] uppercase text-gray-500">{title}</div>
      {summary && <div className="px-3 pt-2 text-[11px] text-gray-600">{summary}</div>}
      {extracted?.message && <div className="px-3 text-[11px] text-gray-600">{extracted.message}</div>}
      <pre className="max-h-60 overflow-auto p-3 text-[11px] text-gray-700 whitespace-pre-wrap">{content}</pre>
    </div>
  );
};

export default RunStudioShell;
