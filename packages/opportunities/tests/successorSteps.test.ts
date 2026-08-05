import { describe, expect, it } from 'vitest';
import type { IOpportunityStep } from '@alga-psa/types';
import { successorPlannedSteps } from '../src/lib/successorSteps';

const step = (step_id: string, status: IOpportunityStep['status']): IOpportunityStep => ({
  tenant: 't1',
  step_id,
  opportunity_id: 'opp-1',
  title: `Step ${step_id}`,
  status,
  stage: 'qualified',
  checkpoint: null,
  due_at: null,
  has_time: false,
  duration_minutes: 30,
  assigned_to: null,
  ticket_id: null,
  project_task_id: null,
  schedule_entry_id: null,
  sort_order: 0,
  completed_at: null,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} as IOpportunityStep);

describe('successorPlannedSteps', () => {
  const steps = [
    step('a', 'done'),
    step('b', 'current'),
    step('c', 'planned'),
    step('d', 'planned'),
  ];

  it('offers only planned steps', () => {
    expect(successorPlannedSteps(steps).map((s) => s.step_id)).toEqual(['c', 'd']);
  });

  it('never offers the step being completed as its own successor', () => {
    expect(successorPlannedSteps(steps, 'c').map((s) => s.step_id)).toEqual(['d']);
  });

  it('leaves the list alone when the completed step was not planned', () => {
    expect(successorPlannedSteps(steps, 'b').map((s) => s.step_id)).toEqual(['c', 'd']);
  });

  it('copes with no completing step id (queue-style callers)', () => {
    expect(successorPlannedSteps(steps, null).map((s) => s.step_id)).toEqual(['c', 'd']);
    expect(successorPlannedSteps([], 'c')).toEqual([]);
  });
});
