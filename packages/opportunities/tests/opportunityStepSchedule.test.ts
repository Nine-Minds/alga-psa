import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOpportunity, IOpportunityStep } from '@alga-psa/types';

/**
 * The step ↔ calendar sync must speak the scheduling domain's language: every
 * entry it writes publishes the same SCHEDULE_ENTRY_* event (same payload
 * shape) the schedule actions publish, and only after the transaction commits.
 * Closing or deleting a deal sweeps the plan's calendar presence the same way.
 */

const dbMocks = vi.hoisted(() => {
  const afterCommitHooks: Array<() => void | Promise<void>> = [];
  const tableHandlers: Record<string, { first?: () => unknown; update?: (patch: unknown) => unknown }> = {};

  function chain(name: string) {
    const q: any = {};
    for (const method of ['where', 'whereIn', 'whereNull', 'whereNot', 'forUpdate', 'orderBy', 'select', 'limit']) {
      q[method] = vi.fn(() => q);
    }
    q.first = vi.fn(async () => tableHandlers[name]?.first?.());
    q.update = vi.fn(async (patch: unknown) => tableHandlers[name]?.update?.(patch) ?? 1);
    q.insert = vi.fn(() => ({ returning: vi.fn(async () => [{}]) }));
    q.delete = vi.fn(async () => 1);
    return q;
  }

  return {
    afterCommitHooks,
    tableHandlers,
    flush: async () => {
      for (const hook of afterCommitHooks.splice(0)) await hook();
    },
    tenantDb: vi.fn(() => ({ table: vi.fn((name: string) => chain(name)) })),
  };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: dbMocks.tenantDb,
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => {
    const result = await fn({} as never);
    await dbMocks.flush(); // simulate commit: after-commit hooks run now
    return result;
  }),
  registerAfterCommit: vi.fn((_trx: unknown, hook: () => void | Promise<void>) => {
    dbMocks.afterCommitHooks.push(hook);
  }),
}));

const eventMocks = vi.hoisted(() => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/event-bus/publishers', () => eventMocks);

const scheduleMocks = vi.hoisted(() => {
  const entries = new Map<string, any>();
  let sequence = 0;
  return {
    entries,
    reset: () => {
      entries.clear();
      sequence = 0;
    },
    seed: (entry: Record<string, unknown> & { entry_id: string }) => {
      entries.set(entry.entry_id, entry);
    },
    model: {
      get: vi.fn(async (_trx: unknown, _tenant: string, id: string) => entries.get(id)),
      create: vi.fn(async (_trx: unknown, tenant: string, entry: Record<string, unknown>, options: { assignedUserIds: string[] }) => {
        const created = {
          ...entry,
          entry_id: `entry-${++sequence}`,
          tenant,
          assigned_user_ids: options.assignedUserIds,
        };
        entries.set(created.entry_id, created);
        return created;
      }),
      update: vi.fn(async (_trx: unknown, _tenant: string, id: string, patch: Record<string, unknown>) => {
        const existing = entries.get(id);
        if (!existing) return undefined;
        const updated = { ...existing, ...patch };
        entries.set(id, updated);
        return updated;
      }),
      delete: vi.fn(async (_trx: unknown, _tenant: string, id: string) => entries.delete(id)),
    },
  };
});

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({ default: scheduleMocks.model }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: never[]) => Promise<unknown>) =>
    (...args: unknown[]) => (action as (...inner: unknown[]) => Promise<unknown>)({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

import { removeOpportunityStepScheduleEntries, syncStepScheduleEntry } from '../src/lib/opportunitySteps';
import { deleteOpportunity, loseOpportunity } from '../src/actions/opportunityActions';
import { OpportunityModel } from '../src/models/opportunityModel';
import { OpportunityStepModel } from '../src/models/opportunityStepModel';

function step(overrides: Partial<IOpportunityStep> = {}): IOpportunityStep {
  return {
    tenant: 'tenant-1',
    step_id: 'step-1',
    opportunity_id: 'opportunity-1',
    title: 'Walk through the assessment',
    due_at: '2026-08-10T13:00:00.000Z',
    has_time: true,
    duration_minutes: 30,
    assigned_to: 'user-2',
    status: 'current',
    schedule_entry_id: null,
    sort_order: 0,
    created_at: '2026-08-01T13:00:00.000Z',
    updated_at: '2026-08-01T13:00:00.000Z',
    ...overrides,
  } as IOpportunityStep;
}

const opportunity = {
  tenant: 'tenant-1',
  opportunity_id: 'opportunity-1',
  title: 'Expansion',
  client_id: 'client-1',
  status: 'open',
  stage: 'qualified',
} as IOpportunity;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  scheduleMocks.reset();
  dbMocks.afterCommitHooks.length = 0;
  for (const key of Object.keys(dbMocks.tableHandlers)) delete dbMocks.tableHandlers[key];
});

describe('syncStepScheduleEntry event publication', () => {
  it('publishes SCHEDULE_ENTRY_CREATED after commit, in the scheduling domain payload shape', async () => {
    const updateSpy = vi.spyOn(OpportunityStepModel, 'update').mockImplementation(
      async (_trx, _tenant, stepId, patch) => step({ step_id: stepId, ...patch }) as never,
    );

    await syncStepScheduleEntry({} as never, 'tenant-1', step(), opportunity, 'user-1');

    // Inside the transaction nothing has been published yet.
    expect(eventMocks.publishEvent).not.toHaveBeenCalled();
    await dbMocks.flush();

    expect(eventMocks.publishEvent).toHaveBeenCalledTimes(1);
    expect(eventMocks.publishEvent).toHaveBeenCalledWith({
      eventType: 'SCHEDULE_ENTRY_CREATED',
      payload: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        entryId: 'entry-1',
        changes: {
          after: expect.objectContaining({
            id: 'entry-1',
            title: 'Expansion: Walk through the assessment',
            workItemId: 'step-1',
            workItemType: 'opportunity_step',
            assignedUserIds: ['user-2'],
          }),
          assignedUserIds: ['user-2'],
        },
      },
    });
    expect(updateSpy).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'step-1', { schedule_entry_id: 'entry-1' });
  });

  it('publishes SCHEDULE_ENTRY_UPDATED with before and after when the entry moves', async () => {
    scheduleMocks.seed({
      entry_id: 'entry-9',
      title: 'Expansion: Walk through the assessment',
      scheduled_start: '2026-08-09T13:00:00.000Z',
      scheduled_end: '2026-08-09T13:30:00.000Z',
      status: 'scheduled',
      work_item_id: 'step-1',
      work_item_type: 'opportunity_step',
      assigned_user_ids: ['user-2'],
    });

    await syncStepScheduleEntry({} as never, 'tenant-1', step({ schedule_entry_id: 'entry-9' }), opportunity, 'user-1');
    await dbMocks.flush();

    expect(eventMocks.publishEvent).toHaveBeenCalledTimes(1);
    const { eventType, payload } = eventMocks.publishEvent.mock.calls[0][0] as any;
    expect(eventType).toBe('SCHEDULE_ENTRY_UPDATED');
    expect(payload.entryId).toBe('entry-9');
    expect(payload.changes.updateType).toBe('single');
    expect(payload.changes.before.scheduledStart).toBe('2026-08-09T13:00:00.000Z');
    expect(payload.changes.after.scheduledStart).toBe('2026-08-10T13:00:00.000Z');
  });

  it('publishes SCHEDULE_ENTRY_DELETED when the step no longer belongs on a calendar', async () => {
    scheduleMocks.seed({
      entry_id: 'entry-9',
      title: 'Expansion: Walk through the assessment',
      scheduled_start: '2026-08-10T13:00:00.000Z',
      scheduled_end: '2026-08-10T13:30:00.000Z',
      status: 'scheduled',
      work_item_id: 'step-1',
      work_item_type: 'opportunity_step',
      assigned_user_ids: ['user-2'],
    });
    const updateSpy = vi.spyOn(OpportunityStepModel, 'update').mockImplementation(
      async (_trx, _tenant, stepId, patch) => step({ step_id: stepId, ...patch }) as never,
    );

    await syncStepScheduleEntry({} as never, 'tenant-1', step({ has_time: false, schedule_entry_id: 'entry-9' }), opportunity, 'user-1');
    await dbMocks.flush();

    expect(scheduleMocks.entries.has('entry-9')).toBe(false);
    expect(updateSpy).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'step-1', { schedule_entry_id: null });
    expect(eventMocks.publishEvent).toHaveBeenCalledTimes(1);
    const { eventType, payload } = eventMocks.publishEvent.mock.calls[0][0] as any;
    expect(eventType).toBe('SCHEDULE_ENTRY_DELETED');
    expect(payload.changes.deleteType).toBe('single');
    expect(payload.changes.before.id).toBe('entry-9');
  });
});

describe('removeOpportunityStepScheduleEntries', () => {
  it('deletes every step entry, clears the pointers, and publishes a delete per entry', async () => {
    scheduleMocks.seed({ entry_id: 'entry-a', title: 'A', work_item_id: 'step-1', work_item_type: 'opportunity_step', status: 'scheduled', assigned_user_ids: ['user-2'] });
    scheduleMocks.seed({ entry_id: 'entry-b', title: 'B', work_item_id: 'step-3', work_item_type: 'opportunity_step', status: 'scheduled', assigned_user_ids: ['user-3'] });

    vi.spyOn(OpportunityStepModel, 'lockForOpportunity').mockResolvedValue(undefined);
    vi.spyOn(OpportunityStepModel, 'listForOpportunity').mockResolvedValue([
      step({ step_id: 'step-1', schedule_entry_id: 'entry-a' }),
      step({ step_id: 'step-2', schedule_entry_id: null, status: 'planned' }),
      step({ step_id: 'step-3', schedule_entry_id: 'entry-b', status: 'planned' }),
    ]);
    const updateSpy = vi.spyOn(OpportunityStepModel, 'update').mockImplementation(
      async (_trx, _tenant, stepId, patch) => step({ step_id: stepId, ...patch }) as never,
    );

    await removeOpportunityStepScheduleEntries({} as never, 'tenant-1', 'opportunity-1', 'user-1');
    await dbMocks.flush();

    expect(scheduleMocks.entries.size).toBe(0);
    expect(updateSpy).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'step-1', { schedule_entry_id: null });
    expect(updateSpy).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'step-3', { schedule_entry_id: null });
    expect(updateSpy).not.toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'step-2', expect.anything());

    const deletes = eventMocks.publishEvent.mock.calls.filter(([event]: any[]) => event.eventType === 'SCHEDULE_ENTRY_DELETED');
    expect(deletes.map(([event]: any[]) => event.payload.entryId).sort()).toEqual(['entry-a', 'entry-b']);
  });
});

describe('closing and deleting a deal', () => {
  it('loseOpportunity removes calendar entries but keeps the steps as plan history', async () => {
    dbMocks.tableHandlers.opportunities = { first: () => ({ ...opportunity }) };
    scheduleMocks.seed({ entry_id: 'entry-a', title: 'A', work_item_id: 'step-1', work_item_type: 'opportunity_step', status: 'scheduled', assigned_user_ids: ['user-2'] });

    vi.spyOn(OpportunityStepModel, 'lockForOpportunity').mockResolvedValue(undefined);
    vi.spyOn(OpportunityStepModel, 'listForOpportunity').mockResolvedValue([
      step({ step_id: 'step-1', schedule_entry_id: 'entry-a' }),
    ]);
    const stepUpdateSpy = vi.spyOn(OpportunityStepModel, 'update').mockImplementation(
      async (_trx, _tenant, stepId, patch) => step({ step_id: stepId, ...patch }) as never,
    );
    const stepDeleteSpy = vi.spyOn(OpportunityStepModel, 'delete');
    vi.spyOn(OpportunityModel, 'update').mockImplementation(async (_trx, _tenant, _id, patch) => ({
      ...opportunity,
      ...patch,
    }) as never);

    const result = await (loseOpportunity as any)('opportunity-1', { loss_reason: 'price' });

    expect(result.status).toBe('lost');
    expect(scheduleMocks.entries.size).toBe(0);
    expect(stepUpdateSpy).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'step-1', { schedule_entry_id: null });
    // The plan survives the close — only the calendar presence goes.
    expect(stepDeleteSpy).not.toHaveBeenCalled();

    const deletes = eventMocks.publishEvent.mock.calls.filter(([event]: any[]) => event.eventType === 'SCHEDULE_ENTRY_DELETED');
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0].payload).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      entryId: 'entry-a',
    }));
  });

  it('deleteOpportunity sweeps the entries before the steps cascade away', async () => {
    dbMocks.tableHandlers.quotes = { first: () => undefined };
    scheduleMocks.seed({ entry_id: 'entry-a', title: 'A', work_item_id: 'step-1', work_item_type: 'opportunity_step', status: 'scheduled', assigned_user_ids: ['user-2'] });

    vi.spyOn(OpportunityStepModel, 'lockForOpportunity').mockResolvedValue(undefined);
    vi.spyOn(OpportunityStepModel, 'listForOpportunity').mockResolvedValue([
      step({ step_id: 'step-1', schedule_entry_id: 'entry-a' }),
    ]);
    vi.spyOn(OpportunityStepModel, 'update').mockImplementation(
      async (_trx, _tenant, stepId, patch) => step({ step_id: stepId, ...patch }) as never,
    );
    const deleteSpy = vi.spyOn(OpportunityModel, 'delete').mockResolvedValue(true);

    await (deleteOpportunity as any)('opportunity-1');

    expect(scheduleMocks.entries.size).toBe(0);
    expect(deleteSpy).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'opportunity-1');
    const deletes = eventMocks.publishEvent.mock.calls.filter(([event]: any[]) => event.eventType === 'SCHEDULE_ENTRY_DELETED');
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0].payload.entryId).toBe('entry-a');
  });
});
