'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityEvidenceLadderStep, IOpportunityStep, OpportunityStage } from '@alga-psa/types';
import {
  applyOpportunityStepTemplate,
  completeOpportunityStep,
  createOpportunityStep,
  deleteOpportunityStep,
  listLinkableProjectTasksForOpportunity,
  listLinkableTicketsForOpportunity,
  listOpportunitySteps,
  listOpportunityStepTemplates,
  updateOpportunityStep,
  type OpportunityLinkableWorkItem,
  type OpportunityStepAssignee,
} from '../../actions/opportunityStepActions';
import { listOpportunityTimeline, type IOpportunityTimelineEntry } from '../../actions/opportunityTimeline';
import { successorPlannedSteps } from '../../lib/successorSteps';
import { CompleteActionDialog } from '../dialogs/CompleteActionDialog';
import { StepEditorDialog, type StepEditorValue } from '../dialogs/StepEditorDialog';
import { OpportunityStepTimeline, type PlannableStage, type StepEditFocus } from './OpportunityStepTimeline';

/**
 * The centre of the deal screen: the timeline plus the plan behind it. Owns
 * the step data so the detail view stays presentational.
 */
export function OpportunityPlanPanel({
  opportunityId,
  stage,
  ladder,
  isOpen,
  assignees,
  refreshKey,
  onStageSelect,
  onChanged,
}: {
  opportunityId: string;
  stage: OpportunityStage;
  /** Evidence states, so the plan's spine can show what has been proven. */
  ladder: IOpportunityEvidenceLadderStep[];
  isOpen: boolean;
  assignees: OpportunityStepAssignee[];
  /** Bumped by the host after any deal change so the plan refetches. */
  refreshKey?: string | number;
  onStageSelect?: (stage: PlannableStage) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [steps, setSteps] = useState<IOpportunityStep[] | null>(null);
  const [entries, setEntries] = useState<IOpportunityTimelineEntry[]>([]);
  const [templateCounts, setTemplateCounts] = useState<Partial<Record<PlannableStage, number>>>({});
  const [tickets, setTickets] = useState<OpportunityLinkableWorkItem[]>([]);
  const [tasks, setTasks] = useState<OpportunityLinkableWorkItem[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStep, setEditorStep] = useState<IOpportunityStep | null>(null);
  const [editorStage, setEditorStage] = useState<PlannableStage | null>(null);
  const [editorFocus, setEditorFocus] = useState<StepEditFocus>('title');
  const [completing, setCompleting] = useState<IOpportunityStep | null>(null);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    const [stepRows, timelineRows] = await Promise.all([
      listOpportunitySteps(opportunityId),
      listOpportunityTimeline(opportunityId).catch(() => [] as IOpportunityTimelineEntry[]),
    ]);
    // A fetch that lands after unmount (or after the panel moved to another
    // opportunity) must not write into the newer panel's state.
    if (!isActive()) return;
    setSteps(stepRows);
    setEntries(timelineRows);
  }, [opportunityId]);

  useEffect(() => {
    let active = true;
    load(() => active).catch(() => {
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
      listOpportunityStepTemplates().catch(() => []),
    ]).then(([ticketRows, taskRows, templates]) => {
      if (!active) return;
      setTickets(ticketRows);
      setTasks(taskRows);
      setTemplateCounts(templates.reduce<Partial<Record<PlannableStage, number>>>((counts, template) => {
        const key = template.stage as PlannableStage;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}));
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

  /**
   * Fire-and-forget variant for callers with no dialog to keep open: the
   * failure has already been toasted by `run`, so nothing is left to reject
   * into the void as an unhandled rejection.
   */
  const runQuietly = (fn: () => Promise<unknown>, message: string) => {
    run(fn, message).catch(() => {});
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
        : createOpportunityStep(opportunityId, { ...payload, stage: editorStage })),
      editorStep
        ? t('opportunities.toast.stepSaved', 'Step saved')
        : t('opportunities.toast.stepAdded', 'Step added to the plan'),
    );
  };

  const openEditor = (step: IOpportunityStep | null, focus: StepEditFocus, forStage: PlannableStage | null) => {
    setEditorStep(step);
    setEditorStage(forStage);
    setEditorFocus(focus);
    setEditorOpen(true);
  };

  if (steps === null) return <Skeleton className="h-32 w-full" />;

  return (
    <>
      <OpportunityStepTimeline
        entries={entries}
        steps={steps}
        ladder={ladder}
        stage={stage}
        isOpen={isOpen}
        templateCounts={templateCounts}
        onStageSelect={onStageSelect}
        onAddStep={(forStage) => openEditor(null, 'title', forStage)}
        onApplyTemplate={(stages) =>
          runQuietly(
            () => applyOpportunityStepTemplate(opportunityId, stages),
            stages.length > 1
              ? t('opportunities.toast.stagesPlanned', 'Steps added for {{count}} stages', { count: stages.length })
              : t('opportunities.toast.stagePlanned', 'Stage plan added'),
          )
        }
        onCompleteStep={(step) => setCompleting(step)}
        onEditStep={(step, focus) => openEditor(step, focus, (step.stage as PlannableStage | null) ?? null)}
        onDeleteStep={(step) =>
          runQuietly(
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
        // A planned step being completed must not be offered as its own successor.
        plannedSteps={successorPlannedSteps(steps, completing?.step_id)}
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
