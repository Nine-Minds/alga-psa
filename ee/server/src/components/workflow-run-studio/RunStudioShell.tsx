'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCurrentUserPermissions } from '@alga-psa/user-composition/actions';
import {
  getWorkflowDefinitionVersionAction,
  getWorkflowRunAction,
  listWorkflowRunsAction,
  listWorkflowRunStepsAction,
} from '@alga-psa/workflows/actions';
import { useFormatWorkflowRunStatus } from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import { type NodeStep, type Step, type WorkflowDefinition } from '@alga-psa/workflows/runtime/client';
import toast from 'react-hot-toast';
import WorkflowGraph from '../workflow-graph/WorkflowGraph';
import WorkflowRunDetailsPanel from './WorkflowRunDetailsPanel';

const statusBadgeClasses: Record<string, string> = {
  RUNNING: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30',
  WAITING: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
  SUCCEEDED: 'bg-green-500/15 text-green-600 border-green-500/30',
  FAILED: 'bg-red-500/15 text-red-600 border-red-500/30',
  CANCELED: 'bg-gray-500/15 text-gray-600 border-gray-500/30',
};

type RunStudioShellProps = {
  runId: string;
};

type WorkflowRunRecord = {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
};

type WorkflowRunStepRecord = {
  step_id: string;
  step_path: string;
  definition_step_id: string;
  status: string;
  started_at: string;
};

const RunStudioShell: React.FC<RunStudioShellProps> = ({ runId }) => {
  const { t } = useTranslation('msp/workflows');
  const formatWorkflowRunStatus = useFormatWorkflowRunStatus();
  const [run, setRun] = useState<WorkflowRunRecord | null>(null);
  const [workflowName, setWorkflowName] = useState<string | undefined>(undefined);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [steps, setSteps] = useState<WorkflowRunStepRecord[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [pipelineViewMode, setPipelineViewMode] = useState<'graph' | 'list'>('graph');
  const [canAdmin, setCanAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

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

  useEffect(() => {
    getCurrentUserPermissions()
      .then((permissions) => setCanAdmin((permissions ?? []).includes('workflow:admin')))
      .catch(() => setCanAdmin(false));
  }, []);

  const getStepLabel = useCallback((step: Step): string => {
    if (step.type === 'action.call') {
      const config = (step as NodeStep).config as { actionId?: string } | undefined;
      return config?.actionId
        ? t('runStudio.stepLabels.action', { defaultValue: 'Action: {{actionId}}', actionId: config.actionId })
        : step.id;
    }
    if (step.type === 'control.if') {
      return t('runStudio.stepLabels.ifCondition', { defaultValue: 'If Condition' });
    }
    if (step.type === 'control.forEach') {
      return t('runStudio.stepLabels.forEach', { defaultValue: 'For Each' });
    }
    if (step.type === 'control.tryCatch') {
      return t('runStudio.stepLabels.tryCatch', { defaultValue: 'Try/Catch' });
    }
    if (step.type === 'event.wait') {
      return t('runStudio.stepLabels.waitForEvent', { defaultValue: 'Wait for Event' });
    }
    if (step.type === 'time.wait') {
      return t('runStudio.stepLabels.waitForTime', { defaultValue: 'Wait for Time' });
    }
    if (step.type === 'human.task') {
      return t('runStudio.stepLabels.humanTask', { defaultValue: 'Human Task' });
    }
    if (step.type === 'state.set') {
      return t('runStudio.stepLabels.setState', { defaultValue: 'Set State' });
    }
    if (step.type === 'transform.assign') {
      return t('runStudio.stepLabels.assign', { defaultValue: 'Assign' });
    }
    return step.id;
  }, [t]);

  const fetchStudioContext = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const [runData, stepData, runListData] = await Promise.all([
        getWorkflowRunAction({ runId }),
        listWorkflowRunStepsAction({ runId }),
        listWorkflowRunsAction({ runId, limit: 1, cursor: 0 }),
      ]);
      const nextRun = runData as WorkflowRunRecord;
      setRun(nextRun);
      setSteps((stepData.steps ?? []) as WorkflowRunStepRecord[]);
      setWorkflowName((runListData?.runs?.[0]?.workflow_name ?? undefined) as string | undefined);

      if (nextRun?.workflow_id && nextRun?.workflow_version) {
        const version = await getWorkflowDefinitionVersionAction({
          workflowId: nextRun.workflow_id,
          version: nextRun.workflow_version,
        });
        setDefinition((version?.definition_json ?? null) as WorkflowDefinition | null);
      } else {
        setDefinition(null);
      }
      setLastRefreshedAt(new Date());
    } catch (error) {
      toast.error(t('runStudio.toasts.loadFailed', { defaultValue: 'Failed to load run studio' }));
    } finally {
      setIsLoading(false);
    }
  }, [runId, t]);

  useEffect(() => {
    fetchStudioContext();
  }, [fetchStudioContext]);

  useEffect(() => {
    if (!run || (run.status !== 'RUNNING' && run.status !== 'WAITING')) return;
    const interval = window.setInterval(() => {
      fetchStudioContext(false);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [fetchStudioContext, run]);

  const orderedSteps = useMemo(() => {
    return (definition?.steps ?? []) as Step[];
  }, [definition]);

  const stepStatusById = useMemo(() => {
    const latestByDefinitionId = new Map<string, WorkflowRunStepRecord>();
    for (const step of steps) {
      const existing = latestByDefinitionId.get(step.definition_step_id);
      if (!existing || new Date(step.started_at).getTime() > new Date(existing.started_at).getTime()) {
        latestByDefinitionId.set(step.definition_step_id, step);
      }
    }

    const statuses = new Map<string, string>();
    latestByDefinitionId.forEach((step, definitionStepId) => {
      statuses.set(definitionStepId, step.status);
    });
    return statuses;
  }, [steps]);

  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;
    return orderedSteps.find((step) => step.id === selectedStepId) ?? null;
  }, [orderedSteps, selectedStepId]);

  const runStatus = run?.status ?? 'UNKNOWN';

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[rgb(var(--color-background))] p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link className="text-sm text-primary-600 hover:text-primary-700" href="/msp/workflow-control?section=runs">
            {t('runStudio.navigation.backToRuns', { defaultValue: '← Back to workflow runs' })}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">
              {t('runStudio.title', { defaultValue: 'Workflow Run Studio' })}
            </h1>
            <Badge className={statusBadgeClasses[runStatus] ?? 'bg-gray-100 text-gray-600'}>
              {run?.status ? formatWorkflowRunStatus(run.status) : t('runStudio.status.loading', { defaultValue: 'Loading' })}
            </Badge>
          </div>
          <div className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
            <span className="font-mono break-all">{runId}</span>
            {workflowName ? <span> · {workflowName}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastRefreshedAt ? (
            <span className="text-xs text-[rgb(var(--color-text-500))]">
              {t('runStudio.lastRefreshed', {
                defaultValue: 'Last refreshed {{time}}',
                time: lastRefreshedAt.toLocaleTimeString(),
              })}
            </span>
          ) : null}
          <Button
            id="workflow-run-studio-refresh"
            variant="outline"
            size="sm"
            onClick={() => fetchStudioContext()}
            disabled={isLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('runStudio.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden xl:grid-cols-[minmax(28rem,42rem)_minmax(0,1fr)]">
        <Card className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
                {t('runStudio.pipeline.title', { defaultValue: 'Execution Pipeline' })}
              </div>
              <div className="text-xs text-[rgb(var(--color-text-500))]">
                {selectedStep
                  ? t('runStudio.pipeline.selectedStep', {
                      defaultValue: 'Selected: {{label}}',
                      label: getStepLabel(selectedStep),
                    })
                  : t('runStudio.pipeline.selectPrompt', { defaultValue: 'Select a step to highlight it.' })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                id="workflow-run-pipeline-view-graph"
                variant={pipelineViewMode === 'graph' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPipelineViewMode('graph')}
              >
                {t('runStudio.pipeline.view.graph', { defaultValue: 'Graph' })}
              </Button>
              <Button
                id="workflow-run-pipeline-view-list"
                variant={pipelineViewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPipelineViewMode('list')}
              >
                {t('runStudio.pipeline.view.list', { defaultValue: 'List' })}
              </Button>
            </div>
          </div>

          {pipelineViewMode === 'graph' ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
              {orderedSteps.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-[rgb(var(--color-text-500))]">
                  {isLoading
                    ? t('runStudio.pipeline.states.loadingDefinition', { defaultValue: 'Loading workflow definition…' })
                    : t('runStudio.pipeline.states.noSteps', { defaultValue: 'No steps to display.' })}
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
            <div className="min-h-0 flex-1 overflow-auto rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3">
              {orderedSteps.length === 0 ? (
                <div className="rounded border border-dashed border-[rgb(var(--color-border-200))] p-6 text-sm text-[rgb(var(--color-text-500))]">
                  {isLoading
                    ? t('runStudio.pipeline.states.loadingDefinitionPlain', { defaultValue: 'Loading workflow definition...' })
                    : t('runStudio.pipeline.states.noSteps', { defaultValue: 'No steps to display.' })}
                </div>
              ) : (
                <div className="space-y-2">
                  {orderedSteps.map((step) => (
                    <button
                      id={`workflow-run-studio-step-${step.id}`}
                      key={step.id}
                      type="button"
                      onClick={() => setSelectedStepId(step.id)}
                      className={`w-full rounded border p-3 text-left text-sm transition-colors ${
                        selectedStepId === step.id
                          ? 'border-primary-400 bg-primary-50 dark:bg-primary-500/20'
                          : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] hover:bg-[rgb(var(--color-background))]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-[rgb(var(--color-text-800))]">{getStepLabel(step)}</span>
                        <Badge className="bg-gray-100 text-gray-700">
                          {stepStatusById.get(step.id) ?? t('runStudio.status.pending', { defaultValue: 'Pending' })}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{step.type}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="min-h-0 min-w-0 overflow-y-auto pr-2 pb-6">
          <WorkflowRunDetailsPanel
            runId={runId}
            workflowName={workflowName}
            canAdmin={canAdmin}
          />
        </div>
      </div>
    </div>
  );
};

export default RunStudioShell;
