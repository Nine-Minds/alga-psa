import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOpportunity, IOpportunityStep } from '@alga-psa/types';

const dbMocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: dbMocks.tenantDb,
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({} as never)),
  registerAfterCommit: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: never[]) => Promise<unknown>) =>
    (...args: unknown[]) => (action as (...inner: unknown[]) => Promise<unknown>)({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

import {
  currentStep,
  mirrorOfCurrentStep,
  nextPlannedStep,
  scheduleWindow,
  stepStageOf,
  templateDueDate,
  unplannedRemainingStages,
} from '../src/lib/opportunityStepPlan';
import { completeOpportunityStepCore, ensureCurrentStep } from '../src/lib/opportunitySteps';
import {
  applyOpportunityStepTemplate,
  deleteOpportunityStep,
  updateOpportunityStep,
} from '../src/actions/opportunityStepActions';
import { OpportunityModel } from '../src/models/opportunityModel';
import { OpportunityStepModel } from '../src/models/opportunityStepModel';

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

  it('files an untagged step under the stage the deal is working through', () => {
    expect(stepStageOf(step(), 'assessment')).toBe('assessment');
    expect(stepStageOf(step({ stage: 'verbal' }), 'assessment')).toBe('verbal');
    expect(stepStageOf(step(), null)).toBeNull();
  });

  it('offers only the stages ahead that have suggestions and no steps yet', () => {
    const steps = [step({ step_id: 'a', stage: 'assessment' })];
    const counts = { identified: 2, qualified: 2, assessment: 2, proposed: 2, verbal: 0 } as const;

    // Assessment already has a step, verbal has nothing to suggest.
    expect(unplannedRemainingStages(steps, 'assessment', counts)).toEqual(['proposed']);
    // Stages already behind the deal are never offered.
    expect(unplannedRemainingStages([], 'proposed', counts)).toEqual(['proposed']);
    // A closed deal has no pipeline left to plan.
    expect(unplannedRemainingStages([], null, counts)).toEqual([]);
  });

  it('draws the evidence ladder down the middle of the plan', () => {
    const timeline = source('../src/components/detail/OpportunityStepTimeline.tsx');
    expect(timeline).toContain('id="opportunity-stage-segments"');
    expect(timeline).toContain('opportunity-stage-segment-');
    expect(timeline).toContain("t('opportunities.steps.stageNow'");
    // The horizontal ladder tile is gone from the side rail.
    expect(source('../src/components/detail/OpportunityDetailView.tsx')).not.toContain('EvidenceLadder');
  });

  it('sets the stage from the rung itself, not a button beside it', () => {
    const timeline = source('../src/components/detail/OpportunityStepTimeline.tsx');
    expect(timeline).toContain('-dot`}');
    expect(timeline).toContain("t('opportunities.steps.setStageTooltip'");
    expect(timeline).toContain("t('opportunities.steps.stageHint'");
    expect(timeline).not.toContain('setStageHere');
  });

  it('names how many steps the suggestion buttons would add', () => {
    const timeline = source('../src/components/detail/OpportunityStepTimeline.tsx');
    expect(timeline).toContain("t('opportunities.steps.applyTemplate'");
    expect(timeline).toContain('count: templateCount');
    expect(timeline).toContain('id="opportunity-step-plan-remaining"');
  });
});

const planOpportunity = {
  tenant: 'tenant-1',
  opportunity_id: 'opportunity-1',
  opportunity_number: 'OPP-0001',
  client_id: 'client-1',
  contact_id: 'contact-1',
  title: 'Expansion',
  opportunity_type: 'expansion',
  owner_id: 'user-1',
  status: 'open',
  stage: 'qualified',
  confidence: 'medium',
  mrr_cents: 0,
  nrr_cents: 0,
  hardware_cents: 0,
  currency_code: 'USD',
  values_locked_by_quote: false,
  next_action: 'Book the assessment',
  next_action_due: '2026-08-10T13:00:00.000Z',
  last_activity_at: '2026-08-01T13:00:00.000Z',
  created_by: 'user-1',
  created_at: '2026-08-01T13:00:00.000Z',
  updated_at: '2026-08-01T13:00:00.000Z',
} as IOpportunity;

/** A live in-memory plan behind the model spies, so flows mutate real state. */
function mockPlan(initial: IOpportunityStep[], opportunity: IOpportunity = planOpportunity): IOpportunityStep[] {
  const steps = initial.map((entry) => ({ ...entry }));
  vi.spyOn(OpportunityModel, 'getById').mockResolvedValue(opportunity);
  vi.spyOn(OpportunityModel, 'update').mockImplementation(async (_trx, _tenant, _id, patch) => ({
    ...opportunity,
    ...patch,
  }));
  vi.spyOn(OpportunityStepModel, 'lockForOpportunity').mockResolvedValue(undefined);
  vi.spyOn(OpportunityStepModel, 'listForOpportunity').mockImplementation(async () => steps as never);
  vi.spyOn(OpportunityStepModel, 'getById').mockImplementation(
    async (_trx, _tenant, id) => (steps.find((entry) => entry.step_id === id) ?? null) as never,
  );
  vi.spyOn(OpportunityStepModel, 'nextSortOrder').mockImplementation(async () => steps.length);
  vi.spyOn(OpportunityStepModel, 'update').mockImplementation(async (_trx, _tenant, id, patch) => {
    const index = steps.findIndex((entry) => entry.step_id === id);
    if (index < 0) throw new Error('Step not found');
    steps[index] = { ...steps[index], ...patch } as IOpportunityStep;
    return steps[index];
  });
  vi.spyOn(OpportunityStepModel, 'markDone').mockImplementation(async (_trx, _tenant, id, patch) => {
    const index = steps.findIndex((entry) => entry.step_id === id);
    if (index < 0 || steps[index].status === 'done') return null;
    steps[index] = { ...steps[index], ...patch, status: 'done' } as IOpportunityStep;
    return steps[index];
  });
  vi.spyOn(OpportunityStepModel, 'create').mockImplementation(async (_trx, _tenant, input) => {
    const created = step({ step_id: `created-${steps.length + 1}`, ...input } as Partial<IOpportunityStep>);
    steps.push(created);
    return created;
  });
  vi.spyOn(OpportunityStepModel, 'delete').mockImplementation(async (_trx, _tenant, id) => {
    const index = steps.findIndex(
      (entry) => entry.step_id === id && (entry.status === 'planned' || entry.status === 'current'),
    );
    if (index < 0) return false;
    steps.splice(index, 1);
    return true;
  });
  return steps;
}

describe('step plan invariants', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    const systemTypeQuery: any = {
      where: vi.fn(),
      select: vi.fn(),
      first: vi.fn().mockResolvedValue({ type_id: 'note-type' }),
    };
    systemTypeQuery.where.mockReturnValue(systemTypeQuery);
    systemTypeQuery.select.mockReturnValue(systemTypeQuery);

    dbMocks.insert.mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ interaction_id: 'interaction-1' }]),
    });

    dbMocks.tenantDb.mockReturnValue({
      table: vi.fn((tableName: string) => tableName === 'system_interaction_types'
        ? systemTypeQuery
        : { insert: dbMocks.insert }),
    });
  });

  it('completing a planned step leaves the deal with its existing current step', async () => {
    const steps = mockPlan([
      step({ step_id: 'a', status: 'current', title: 'Call Dana', sort_order: 0 }),
      step({ step_id: 'b', status: 'planned', title: 'Send recap', sort_order: 1 }),
      step({ step_id: 'c', status: 'planned', title: 'Book review', sort_order: 2 }),
    ]);

    const result = await completeOpportunityStepCore({} as never, 'tenant-1', 'opportunity-1', 'b', 'user-1');

    expect(result.completed.status).toBe('done');
    expect(result.completed.interaction_id).toBe('interaction-1');
    expect(result.promoted).toBeUndefined();
    expect(steps.filter((entry) => entry.status === 'current').map((entry) => entry.step_id)).toEqual(['a']);
    expect(steps.find((entry) => entry.step_id === 'c')?.status).toBe('planned');
  });

  it('rejects a next step that is done, foreign, or the step being completed', async () => {
    mockPlan([
      step({ step_id: 'a', status: 'current', sort_order: 0 }),
      step({ step_id: 'b', status: 'planned', sort_order: 1 }),
      step({ step_id: 'd', status: 'done', sort_order: 2 }),
    ]);

    for (const nextStepId of ['d', 'a', 'not-in-this-plan']) {
      await expect(
        completeOpportunityStepCore({} as never, 'tenant-1', 'opportunity-1', 'a', 'user-1', { next_step_id: nextStepId }),
      ).rejects.toThrow('Next step must be a planned step of this opportunity');
    }
  });

  it('promotes the next planned step when the current one is deleted', async () => {
    const steps = mockPlan([
      step({ step_id: 'a', status: 'current', title: 'Call Dana', sort_order: 0 }),
      step({ step_id: 'b', status: 'planned', title: 'Send recap', sort_order: 1 }),
    ]);

    await expect(deleteOpportunityStep('a')).resolves.toBe(true);

    expect(steps.map((entry) => [entry.step_id, entry.status])).toEqual([['b', 'current']]);
    expect(OpportunityModel.update).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'opportunity-1',
      expect.objectContaining({ next_action: 'Send recap' }),
    );
  });

  it('promotes the next planned step when the current one is skipped', async () => {
    const steps = mockPlan([
      step({ step_id: 'a', status: 'current', title: 'Call Dana', sort_order: 0 }),
      step({ step_id: 'b', status: 'planned', title: 'Send recap', sort_order: 1 }),
    ]);

    await updateOpportunityStep('a', { status: 'skipped' });

    expect(steps.find((entry) => entry.step_id === 'a')?.status).toBe('skipped');
    expect(steps.find((entry) => entry.step_id === 'b')?.status).toBe('current');
  });

  it('heals a stranded plan even when the mirror columns are empty', async () => {
    const steps = mockPlan(
      [step({ step_id: 'b', status: 'planned', title: 'Send recap', sort_order: 1 })],
      { ...planOpportunity, next_action: null, next_action_due: null },
    );

    await ensureCurrentStep({} as never, 'tenant-1', { ...planOpportunity, next_action: null }, 'user-1');

    expect(steps.find((entry) => entry.step_id === 'b')?.status).toBe('current');
  });

  it('does not duplicate a stage-less step when its template stage is re-applied', async () => {
    const steps = mockPlan([
      step({ step_id: 'a', status: 'current', title: 'Book assessment', stage: null, sort_order: 0 }),
    ]);
    vi.spyOn(OpportunityStepModel, 'listTemplates').mockResolvedValue([
      { tenant: 'tenant-1', template_id: 't1', stage: 'qualified', title: 'Book assessment', sort_order: 0, due_offset_days: 3, is_active: true },
      { tenant: 'tenant-1', template_id: 't2', stage: 'qualified', title: 'Confirm requirements', sort_order: 1, due_offset_days: 5, is_active: true },
    ]);

    await applyOpportunityStepTemplate('opportunity-1', 'qualified');

    expect(steps.filter((entry) => entry.title === 'Book assessment')).toHaveLength(1);
    expect(steps.map((entry) => entry.title)).toEqual(['Book assessment', 'Confirm requirements']);
    expect(steps.filter((entry) => entry.status === 'current')).toHaveLength(1);
  });
});
