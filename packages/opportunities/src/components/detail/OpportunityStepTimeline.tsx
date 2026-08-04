'use client';

import React from 'react';
import { CalendarClock, Check, CheckCircle2, Circle, LifeBuoy, ListChecks, Plus, Ticket, Trash2, User } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityEvidenceLadderStep, IOpportunityStep, OpportunityStage } from '@alga-psa/types';
import type { IOpportunityTimelineEntry } from '../../actions/opportunityTimeline';
import { OPEN_OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS } from '../../lib/opportunityStages';
import {
  plannableStage,
  stepStageOf,
  unplannedRemainingStages,
  type PlannableStage,
} from '../../lib/opportunityStepPlan';

export type StepEditFocus = 'title' | 'schedule' | 'ticket' | 'task';
export type { PlannableStage };

/**
 * One feed for the whole deal. The evidence ladder runs down the centre as the
 * spine of the plan, so the stage you are on and the step you are on are the
 * same picture: each stage segment holds its own steps, past, present and
 * greyed-out future, and any stage can be laid out in advance.
 */
export function OpportunityStepTimeline({
  entries,
  steps,
  ladder,
  stage,
  isOpen,
  templateCounts,
  onAddStep,
  onApplyTemplate,
  onStageSelect,
  onCompleteStep,
  onEditStep,
  onDeleteStep,
}: {
  entries: IOpportunityTimelineEntry[];
  steps: IOpportunityStep[];
  /** Evidence states per checkpoint, so the spine shows what has been proven. */
  ladder: IOpportunityEvidenceLadderStep[];
  stage: OpportunityStage;
  isOpen: boolean;
  /** How many suggested steps each stage would add, so the button can say so. */
  templateCounts: Partial<Record<PlannableStage, number>>;
  onAddStep: (stage: PlannableStage | null) => void;
  onApplyTemplate: (stages: PlannableStage[]) => void;
  onStageSelect?: (stage: PlannableStage) => void;
  onCompleteStep: (step: IOpportunityStep) => void;
  onEditStep: (step: IOpportunityStep, focus: StepEditFocus) => void;
  onDeleteStep: (step: IOpportunityStep) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const currentStage = plannableStage(stage);
  const ladderState = new Map(ladder.map((entry) => [entry.checkpoint, entry]));
  const stageOf = (step: IOpportunityStep) => stepStageOf(step, currentStage);
  const unplaced = steps.filter((step) => stageOf(step) === null);
  const unplannedRemaining = unplannedRemainingStages(steps, currentStage, templateCounts);

  return (
    <div id="opportunity-step-timeline" className="space-y-4">
      <ol className="space-y-0.5">
        {entries.map((entry) => (
          <li
            key={entry.interaction_id}
            className="flex gap-3 border-b border-[rgb(var(--color-border-100,241_245_249))] py-2 text-[13px] last:border-b-0"
          >
            <span className="w-20 flex-none font-mono text-[11px] text-[rgb(var(--color-text-400))]">
              {new Date(entry.interaction_date).toLocaleDateString()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-[rgb(var(--color-text-700))]">
                {entry.interaction_id.startsWith('opportunity-created:')
                  ? t('opportunities.timeline.created', 'Opportunity created')
                  : entry.title}
              </span>
              {entry.user_name ? (
                <span className="text-[rgb(var(--color-text-400))]"> · {entry.user_name}</span>
              ) : null}
            </span>
          </li>
        ))}
        {entries.length === 0 ? (
          <li className="py-2 text-[13px] text-[rgb(var(--color-text-400))]">
            {t('opportunities.timeline.empty', 'Nothing logged yet. Completed actions land here on their own.')}
          </li>
        ) : null}
      </ol>

      {isOpen && onStageSelect ? (
        <p id="opportunity-stage-hint" className="text-[11px] text-[rgb(var(--color-text-400))]">
          {t('opportunities.steps.stageHint', 'Click a stage circle to move the deal there.')}
        </p>
      ) : null}

      <ol id="opportunity-stage-segments" className="space-y-0">
        {OPEN_OPPORTUNITY_STAGES.map((entry, index) => (
          <StageSegment
            key={entry}
            stage={entry}
            evidence={ladderState.get(entry)}
            isCurrentStage={entry === currentStage}
            isLast={index === OPEN_OPPORTUNITY_STAGES.length - 1}
            steps={steps.filter((step) => stageOf(step) === entry)}
            templateCount={templateCounts[entry] ?? 0}
            isOpen={isOpen}
            onAddStep={onAddStep}
            onApplyTemplate={onApplyTemplate}
            onStageSelect={onStageSelect}
            onCompleteStep={onCompleteStep}
            onEditStep={onEditStep}
            onDeleteStep={onDeleteStep}
          />
        ))}
      </ol>

      {unplaced.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('opportunities.steps.otherSteps', 'Other steps')}
          </h3>
          {unplaced.map((step) => (
            <StepRow
              key={step.step_id}
              step={step}
              isOpen={isOpen}
              onComplete={onCompleteStep}
              onEdit={onEditStep}
              onDelete={onDeleteStep}
            />
          ))}
        </div>
      ) : null}

      {isOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button id="opportunity-step-add" size="xs" variant="soft" onClick={() => onAddStep(currentStage)}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('opportunities.steps.add', 'Add a step')}
          </Button>
          {unplannedRemaining.length > 0 ? (
            <Button
              id="opportunity-step-plan-remaining"
              size="xs"
              variant="ghost"
              onClick={() => onApplyTemplate(unplannedRemaining)}
            >
              <ListChecks className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t('opportunities.steps.planRemaining', 'Add the suggested steps for all {{count}} remaining stages', {
                count: unplannedRemaining.length,
              })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One rung of the ladder: the checkpoint, what the evidence says about it, and
 * the steps planned to get there.
 */
function StageSegment({
  stage,
  evidence,
  isCurrentStage,
  isLast,
  steps,
  templateCount,
  isOpen,
  onAddStep,
  onApplyTemplate,
  onStageSelect,
  onCompleteStep,
  onEditStep,
  onDeleteStep,
}: {
  stage: PlannableStage;
  evidence?: IOpportunityEvidenceLadderStep;
  isCurrentStage: boolean;
  isLast: boolean;
  steps: IOpportunityStep[];
  templateCount: number;
  isOpen: boolean;
  onAddStep: (stage: PlannableStage) => void;
  onApplyTemplate: (stages: PlannableStage[]) => void;
  onStageSelect?: (stage: PlannableStage) => void;
  onCompleteStep: (step: IOpportunityStep) => void;
  onEditStep: (step: IOpportunityStep, focus: StepEditFocus) => void;
  onDeleteStep: (step: IOpportunityStep) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const labelConfig = OPPORTUNITY_STAGE_LABELS[stage];
  const label = t(labelConfig.key, labelConfig.fallback);
  const state = evidence?.state ?? 'pending';
  const idBase = `opportunity-stage-segment-${stage}`;

  const setStageLabel = t('opportunities.steps.setStageTooltip', 'Move this deal to {{stage}}', { stage: label });
  const canSetStage = Boolean(onStageSelect) && !isCurrentStage;

  const dotFace = (
    <span
      className={`grid h-7 w-7 place-items-center rounded-full border-2 text-[10px] font-bold transition-colors ${
        state === 'reached'
          ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-500))] text-white'
          : state === 'skipped'
            ? 'border-dashed border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-400))]'
            : isCurrentStage
              ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-card))] text-[rgb(var(--color-primary-600))]'
              : 'border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-400))]'
      }`}
      aria-hidden
    >
      {state === 'reached' ? <Check className="h-3.5 w-3.5" /> : state === 'skipped' ? '–' : null}
    </span>
  );

  // The circle is the control: clicking a rung moves the deal to that stage.
  const dot = canSetStage ? (
    <Button
      id={`${idBase}-dot`}
      variant="ghost"
      size="icon"
      className="h-7 w-7 flex-none rounded-full p-0 hover:bg-transparent hover:opacity-80"
      label={setStageLabel}
      aria-label={setStageLabel}
      onClick={() => onStageSelect?.(stage)}
    >
      {dotFace}
    </Button>
  ) : (
    <span className="flex-none">{dotFace}</span>
  );

  const heading = (
    <span className="flex flex-wrap items-center gap-2">
      <Badge
        variant={isCurrentStage ? 'primary' : state === 'reached' ? 'default-muted' : 'outline'}
        size="md"
        className={`uppercase tracking-wider ${
          isCurrentStage || state === 'reached' ? '' : 'border-[rgb(var(--color-border-300))] text-[rgb(var(--color-text-500))]'
        }`}
      >
        {label}
      </Badge>
      {isCurrentStage ? (
        <span className="text-[11px] font-medium text-[rgb(var(--color-primary-600))]">
          {t('opportunities.steps.stageNow', 'You are here')}
        </span>
      ) : null}
    </span>
  );

  return (
    <li id={idBase} className="flex gap-2">
      <div className="flex flex-none flex-col items-center">
        {evidence?.evidence?.detail ? (
          <Tooltip content={evidence.evidence.detail}>{dot}</Tooltip>
        ) : canSetStage ? (
          <Tooltip content={setStageLabel}>{dot}</Tooltip>
        ) : (
          dot
        )}
        {!isLast ? (
          <span
            className={`my-1 w-0.5 flex-1 rounded ${
              state === 'reached' ? 'bg-[rgb(var(--color-primary-300))]' : 'bg-[rgb(var(--color-border-200))]'
            }`}
            aria-hidden
          />
        ) : null}
      </div>
      <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-4'}`}>
        <div className="flex min-h-7 items-center gap-2">{heading}</div>
        {steps.length > 0 ? (
          <div className="mt-2 space-y-2">
            {steps.map((step) => (
              <StepRow
                key={step.step_id}
                step={step}
                isOpen={isOpen}
                onComplete={onCompleteStep}
                onEdit={onEditStep}
                onDelete={onDeleteStep}
              />
            ))}
          </div>
        ) : null}
        {isOpen ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button id={`${idBase}-add-step`} size="xs" variant="ghost" onClick={() => onAddStep(stage)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t('opportunities.steps.addHere', 'Add a step here')}
            </Button>
            {templateCount > 0 ? (
              <Button
                id={`${idBase}-apply-template`}
                size="xs"
                variant="ghost"
                onClick={() => onApplyTemplate([stage])}
              >
                <ListChecks className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {t('opportunities.steps.applyTemplate', 'Add the {{count}} suggested steps', {
                  count: templateCount,
                })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function StepRow({
  step,
  isOpen,
  onComplete,
  onEdit,
  onDelete,
}: {
  step: IOpportunityStep;
  isOpen: boolean;
  onComplete: (step: IOpportunityStep) => void;
  onEdit: (step: IOpportunityStep, focus: StepEditFocus) => void;
  onDelete: (step: IOpportunityStep) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const done = step.status === 'done' || step.status === 'skipped';
  const current = step.status === 'current';
  const overdue = current && step.due_at != null && new Date(step.due_at).getTime() < Date.now();
  const idBase = `opportunity-step-${step.step_id}`;

  return (
    <div
      id={idBase}
      className={`rounded-xl border p-3 ${
        current
          ? overdue
            ? 'border-[rgb(var(--color-accent-200,254_202_202))] bg-[rgb(var(--color-accent-50,254_242_242))]'
            : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]'
          : done
            ? 'border-[rgb(var(--color-border-100,241_245_249))] bg-transparent'
            : 'border-dashed border-[rgb(var(--color-border-200))] bg-transparent opacity-70'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {done ? (
          <Check className="h-4 w-4 text-[rgb(var(--color-text-400))]" aria-hidden="true" />
        ) : current ? (
          <CheckCircle2 className="h-4 w-4 text-[rgb(var(--color-primary-500))]" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 text-[rgb(var(--color-text-400))]" aria-hidden="true" />
        )}
        <span
          className={`flex-1 text-sm ${
            current
              ? 'font-semibold text-[rgb(var(--color-text-900))]'
              : done
                ? 'text-[rgb(var(--color-text-400))] line-through'
                : 'text-[rgb(var(--color-text-600))]'
          }`}
        >
          {step.title}
        </span>
        {step.due_at ? (
          <span
            className={`text-xs font-medium ${
              overdue ? 'text-[rgb(var(--badge-error-text))]' : 'text-[rgb(var(--color-text-500))]'
            }`}
          >
            {step.has_time
              ? new Date(step.due_at).toLocaleString()
              : t('opportunities.detail.due', 'due {{date}}', {
                  date: new Date(step.due_at).toLocaleDateString(),
                })}
          </span>
        ) : null}
        {step.assigned_to_name ? (
          <Badge variant="default-muted" size="sm">{step.assigned_to_name}</Badge>
        ) : null}
        {step.ticket_number ? (
          <Badge variant="default-muted" size="sm">{step.ticket_number}</Badge>
        ) : null}
        {step.project_task_name ? (
          <Badge variant="default-muted" size="sm">{step.project_task_name}</Badge>
        ) : null}
      </div>
      {isOpen && !done ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button id={`${idBase}-schedule`} size="xs" variant="ghost" onClick={() => onEdit(step, 'schedule')}>
            <CalendarClock className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('opportunities.steps.schedule', 'Schedule')}
          </Button>
          <Button id={`${idBase}-link-ticket`} size="xs" variant="ghost" onClick={() => onEdit(step, 'ticket')}>
            <Ticket className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('opportunities.steps.linkTicket', 'Link ticket')}
          </Button>
          <Button id={`${idBase}-link-task`} size="xs" variant="ghost" onClick={() => onEdit(step, 'task')}>
            <LifeBuoy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('opportunities.steps.linkTask', 'Link task')}
          </Button>
          <Button id={`${idBase}-assign`} size="xs" variant="ghost" onClick={() => onEdit(step, 'title')}>
            <User className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('opportunities.steps.assign', 'Assign')}
          </Button>
          <Button id={`${idBase}-delete`} size="xs" variant="ghost" onClick={() => onDelete(step)}>
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('common.delete', 'Delete')}
          </Button>
          <Button
            id={`${idBase}-complete`}
            size="xs"
            variant={current ? 'default' : 'soft'}
            className="ml-auto"
            onClick={() => onComplete(step)}
          >
            {t('opportunities.queue.completeAction', 'Done → set next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
