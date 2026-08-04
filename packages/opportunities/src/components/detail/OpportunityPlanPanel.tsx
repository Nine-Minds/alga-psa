'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityStep, OpportunityStage } from '@alga-psa/types';
import {
  applyOpportunityStepTemplate,
  completeOpportunityStep,
  createOpportunityStep,
  deleteOpportunityStep,
  listLinkableProjectTasksForOpportunity,
  listLinkableTicketsForOpportunity,
  listOpportunitySteps,
  updateOpportunityStep,
  type OpportunityLinkableWorkItem,
  type OpportunityStepAssignee,
} from '../../actions/opportunityStepActions';
import { listOpportunityTimeline, type IOpportunityTimelineEntry } from '../../actions/opportunityTimeline';
import { CompleteActionDialog } from '../dialogs/CompleteActionDialog';
import { StepEditorDialog, type StepEditorValue } from '../dialogs/StepEditorDialog';
import { OpportunityStepTimeline, type StepEditFocus } from './OpportunityStepTimeline';

/**
 * The centre of the deal screen: the timeline plus the plan behind it. Owns
 * the step data so the detail view stays presentational.
 */
export function OpportunityPlanPanel({
  opportunityId,
  stage,
  isOpen,
  assignees,
  refreshKey,
  onChanged,
}: {
  opportunityId: string;
  stage: OpportunityStage;
  isOpen: boolean;
  assignees: OpportunityStepAssignee[];
  /** Bumped by the host after any deal change so the plan refetches. */
  refreshKey?: string | number;
  onChanged: () => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [steps, setSteps] = useState<IOpportunityStep[] | null>(null);
  const [entries, setEntries] = useState<IOpportunityTimelineEntry[]>([]);
  const [tickets, setTickets] = useState<OpportunityLinkableWorkItem[]>([]);
  const [tasks, setTasks] = useState<OpportunityLinkableWorkItem[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStep, setEditorStep] = useState<IOpportunityStep | null>(null);
  const [editorFocus, setEditorFocus] = useState<StepEditFocus>('title');
  const [completing, setCompleting] = useState<IOpportunityStep | null>(null);

  const load = useCallback(async () => {
    const [stepRows, timelineRows] = await Promise.all([
      listOpportunitySteps(opportunityId),
      listOpportunityTimeline(opportunityId).catch(() => [] as IOpportunityTimelineEntry[]),
    ]);
    setSteps(stepRows);
    setEntries(timelineRows);
  }, [opportunityId]);

  useEffect(() => {
    let active = true;
    load().catch(() => {
      if (active) setSteps([]);
    });
    return () => {
      active = false;
    };
  }, [load, refreshKey]);

  useEffect(() => {
    let active = true;
    Promise.all([
      listLinkableTicketsForOpportunity(opportunityId).catch(() => []),
      listLinkableProjectTasksForOpportunity(opportunityId).catch(() => []),
    ]).then(([ticketRows, taskRows]) => {
      if (!active) return;
      setTickets(ticketRows);
      setTasks(taskRows);
    });
    return () => {
      active = false;
    };
  }, [opportunityId]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const saveStep = async (value: StepEditorValue) => {
    const payload = {
      title: value.title,
      due_at: value.due_at,
      has_time: value.has_time,
      duration_minutes: value.duration_minutes,
      assigned_to: value.assigned_to,
      ticket_id: value.ticket_id,
      project_task_id: value.project_task_id,
    };
    await run(
      () => (editorStep
        ? updateOpportunityStep(editorStep.step_id, payload)
        : createOpportunityStep(opportunityId, payload)),
      t('opportunities.toast.saved', 'Saved'),
    );
  };

  if (steps === null) return <Skeleton className="h-32 w-full" />;

  const plannedSteps = steps.filter((step) => step.status === 'planned');

  return (
    <>
      <OpportunityStepTimeline
        entries={entries}
        steps={steps}
        isOpen={isOpen}
        onAddStep={() => {
          setEditorStep(null);
          setEditorFocus('title');
          setEditorOpen(true);
        }}
        onApplyTemplate={() =>
          void run(
            () => applyOpportunityStepTemplate(opportunityId, stage),
            t('opportunities.toast.stagePlanned', 'Stage plan added'),
          )
        }
        onCompleteStep={(step) => setCompleting(step)}
        onEditStep={(step, focus) => {
          setEditorStep(step);
          setEditorFocus(focus);
          setEditorOpen(true);
        }}
        onDeleteStep={(step) =>
          void run(
            () => deleteOpportunityStep(step.step_id),
            t('opportunities.toast.stepDeleted', 'Step removed'),
          )
        }
      />
      <StepEditorDialog
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        step={editorStep}
        assignees={assignees}
        tickets={tickets}
        projectTasks={tasks}
        focus={editorFocus}
        onSubmit={saveStep}
      />
      <CompleteActionDialog
        isOpen={completing != null}
        onClose={() => setCompleting(null)}
        stage={stage}
        plannedSteps={plannedSteps}
        onSubmitPlan={(input) =>
          run(
            () => completeOpportunityStep(opportunityId, completing?.step_id ?? null, input),
            t('opportunities.toast.actionCompleted', 'Done. Next action scheduled.'),
          )
        }
      />
    </>
  );
}
