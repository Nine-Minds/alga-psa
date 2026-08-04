'use client';

import React from 'react';
import { CalendarClock, CheckCircle2, Circle, LifeBuoy, ListChecks, Plus, Ticket, Trash2, User } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityStep } from '@alga-psa/types';
import type { IOpportunityTimelineEntry } from '../../actions/opportunityTimeline';

export type StepEditFocus = 'title' | 'schedule' | 'ticket' | 'task';

/**
 * One feed for the whole deal: what already happened, what is happening now,
 * and the greyed-out plan ahead. Every future step can be given a time, an
 * owner, or a piece of real work to point at without leaving the screen.
 */
export function OpportunityStepTimeline({
  entries,
  steps,
  isOpen,
  onAddStep,
  onApplyTemplate,
  onCompleteStep,
  onEditStep,
  onDeleteStep,
}: {
  entries: IOpportunityTimelineEntry[];
  steps: IOpportunityStep[];
  isOpen: boolean;
  onAddStep: () => void;
  onApplyTemplate: () => void;
  onCompleteStep: (step: IOpportunityStep) => void;
  onEditStep: (step: IOpportunityStep, focus: StepEditFocus) => void;
  onDeleteStep: (step: IOpportunityStep) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const past = steps.filter((step) => step.status === 'done' || step.status === 'skipped');
  const current = steps.find((step) => step.status === 'current');
  const planned = steps.filter((step) => step.status === 'planned');

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
        {past.length === 0 && entries.length === 0 ? (
          <li className="py-2 text-[13px] text-[rgb(var(--color-text-400))]">
            {t('opportunities.timeline.empty', 'Nothing logged yet. Completed actions land here on their own.')}
          </li>
        ) : null}
      </ol>

      {current ? (
        <StepRow
          step={current}
          tone="current"
          isOpen={isOpen}
          onComplete={onCompleteStep}
          onEdit={onEditStep}
          onDelete={onDeleteStep}
        />
      ) : null}

      {planned.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
            {t('opportunities.steps.planned', 'Planned')}
          </h3>
          {planned.map((step) => (
            <StepRow
              key={step.step_id}
              step={step}
              tone="planned"
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
          <Button id="opportunity-step-add" size="xs" variant="soft" onClick={onAddStep}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('opportunities.steps.add', 'Add a step')}
          </Button>
          <Button id="opportunity-step-apply-template" size="xs" variant="ghost" onClick={onApplyTemplate}>
            <ListChecks className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('opportunities.steps.applyTemplate', 'Plan this stage')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StepRow({
  step,
  tone,
  isOpen,
  onComplete,
  onEdit,
  onDelete,
}: {
  step: IOpportunityStep;
  tone: 'current' | 'planned';
  isOpen: boolean;
  onComplete: (step: IOpportunityStep) => void;
  onEdit: (step: IOpportunityStep, focus: StepEditFocus) => void;
  onDelete: (step: IOpportunityStep) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const overdue = tone === 'current' && step.due_at != null && new Date(step.due_at).getTime() < Date.now();
  const idBase = `opportunity-step-${step.step_id}`;

  return (
    <div
      id={idBase}
      className={`rounded-xl border p-3 ${
        tone === 'current'
          ? overdue
            ? 'border-[rgb(var(--color-accent-200,254_202_202))] bg-[rgb(var(--color-accent-50,254_242_242))]'
            : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]'
          : 'border-dashed border-[rgb(var(--color-border-200))] bg-transparent opacity-70'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {tone === 'current' ? (
          <CheckCircle2 className="h-4 w-4 text-[rgb(var(--color-primary-500))]" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 text-[rgb(var(--color-text-400))]" aria-hidden="true" />
        )}
        <span
          className={`flex-1 text-sm ${
            tone === 'current'
              ? 'font-semibold text-[rgb(var(--color-text-900))]'
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
      {isOpen ? (
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
            variant={tone === 'current' ? 'default' : 'soft'}
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
