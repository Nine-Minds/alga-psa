import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IOpportunityStep } from '@alga-psa/types';
import {
  currentStep,
  mirrorOfCurrentStep,
  nextPlannedStep,
  scheduleWindow,
  templateDueDate,
} from '../src/lib/opportunityStepPlan';

function step(overrides: Partial<IOpportunityStep> = {}): IOpportunityStep {
  return {
    tenant: 'tenant-1',
    step_id: 'step-1',
    opportunity_id: 'opportunity-1',
    title: 'Book the assessment',
    due_at: '2026-08-10T13:00:00.000Z',
    has_time: false,
    duration_minutes: 30,
    status: 'planned',
    sort_order: 0,
    created_at: '2026-08-01T13:00:00.000Z',
    updated_at: '2026-08-01T13:00:00.000Z',
    ...overrides,
  } as IOpportunityStep;
}

function source(relative: string) {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('opportunity step plan', () => {
  it('promotes the lowest-ordered planned step, skipping the one being completed', () => {
    const steps = [
      step({ step_id: 'a', status: 'current', sort_order: 0 }),
      step({ step_id: 'c', sort_order: 2 }),
      step({ step_id: 'b', sort_order: 1 }),
    ];
    expect(currentStep(steps)?.step_id).toBe('a');
    expect(nextPlannedStep(steps)?.step_id).toBe('b');
    expect(nextPlannedStep(steps, 'b')?.step_id).toBe('c');
  });

  it('mirrors the current step onto the opportunity columns the queue reads', () => {
    const current = step({ status: 'current', title: 'Call Dana', due_at: '2026-08-12T09:00:00.000Z' });
    expect(mirrorOfCurrentStep(current)).toEqual({
      next_action: 'Call Dana',
      next_action_due: '2026-08-12T09:00:00.000Z',
    });
    expect(mirrorOfCurrentStep(undefined)).toEqual({ next_action: null, next_action_due: null });
  });

  it('gives a timed step a real slot in the calendar', () => {
    expect(scheduleWindow('2026-08-10T13:00:00.000Z', 45)).toEqual({
      start: '2026-08-10T13:00:00.000Z',
      end: '2026-08-10T13:45:00.000Z',
    });
    // A nonsense duration still leaves a bookable slot.
    expect(scheduleWindow('2026-08-10T13:00:00.000Z', 0).end).toBe('2026-08-10T13:15:00.000Z');
  });

  it('spreads template steps out by their own offsets', () => {
    const from = new Date('2026-08-03T18:00:00.000Z');
    const first = new Date(templateDueDate(from, 3));
    const second = new Date(templateDueDate(from, 5));
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(first.getHours()).toBe(9);
  });
});

describe('step plan wiring', () => {
  it('keeps the opportunities columns as a mirror of the current step', () => {
    const steps = source('../src/lib/opportunitySteps.ts');
    expect(steps).toContain('mirrorOfCurrentStep(currentStep(steps))');
    expect(steps).toContain('recordCompletedActionInteraction');
    expect(steps).toContain("work_item_type: 'opportunity_step'");
  });

  it('offers per-step scheduling, linking and assignment on the timeline', () => {
    const timeline = source('../src/components/detail/OpportunityStepTimeline.tsx');
    expect(timeline).toContain('-schedule`}');
    expect(timeline).toContain('-link-ticket`}');
    expect(timeline).toContain('-link-task`}');
    expect(timeline).toContain('-assign`}');
  });

  it('lets Done → next pick a planned step and attest a checkpoint', () => {
    const dialog = source('../src/components/dialogs/CompleteActionDialog.tsx');
    expect(dialog).toContain('id="opportunity-complete-next-step"');
    expect(dialog).toContain('id="opportunity-complete-reaches-stage"');
    expect(dialog).toContain("t('opportunities.completeDialog.reachesStage'");
  });

  it('lays the detail screen out like a ticket', () => {
    const view = source('../src/components/detail/OpportunityDetailView.tsx');
    expect(view).toContain('lg:grid-cols-12');
    expect(view).toContain('xl:col-span-6');
    expect(view).toContain('opportunity-detail-plan-tile');
    expect(view).toContain('opportunity-detail-owner');
  });
});
