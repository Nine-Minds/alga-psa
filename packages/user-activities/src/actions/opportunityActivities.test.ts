import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPriority, ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  getScheduleActivityEntriesForUser: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: mocks.tenantDb,
}));

vi.mock('@alga-psa/scheduling/actions/scheduleActivityCore', () => ({
  getScheduleActivityEntriesForUser: mocks.getScheduleActivityEntriesForUser,
}));

import { fetchOpportunityActivities, fetchScheduleActivities } from './activityAggregationActions';

function queryReturning(rows: Record<string, unknown>[]) {
  const query: any = {
    where: vi.fn(),
    orWhere: vi.fn(),
    andWhere: vi.fn(),
    whereIn: vi.fn(),
    whereNotNull: vi.fn(),
    whereNull: vi.fn(),
    orWhereNull: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  const chainMaybeCallback = (value: unknown) => {
    if (typeof value === 'function') value.call(query);
    return query;
  };
  query.where.mockImplementation(chainMaybeCallback);
  query.andWhere.mockImplementation(chainMaybeCallback);
  query.orWhere.mockReturnValue(query);
  query.whereIn.mockReturnValue(query);
  query.whereNotNull.mockReturnValue(query);
  query.whereNull.mockReturnValue(query);
  query.orWhereNull.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe('opportunity activity aggregation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps a step assigned to the user to an overdue feed activity with a direct link', async () => {
    const query = queryReturning([{
      step_id: 'step-1',
      step_title: 'Call the decision maker',
      step_status: 'current',
      due_at: '2000-01-01T12:00:00.000Z',
      opportunity_id: 'opportunity-1',
      opportunity_number: 'OPP-0001',
      opportunity_title: 'Managed services expansion',
      client_id: 'client-1',
      client_name: 'Acme',
      created_at: '1999-12-01T12:00:00.000Z',
      updated_at: '1999-12-02T12:00:00.000Z',
    }]);
    const facade = { table: vi.fn(() => query), tenantJoin: vi.fn() };
    mocks.createTenantKnex.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    mocks.tenantDb.mockReturnValue(facade);

    const result = await fetchOpportunityActivities('owner-1', 'tenant-1', {});

    expect(query.where).toHaveBeenCalledWith('o.status', 'open');
    expect(query.where).toHaveBeenCalledWith('s.assigned_to', 'owner-1');
    expect(result).toEqual([expect.objectContaining({
      id: 'step-1',
      type: ActivityType.SCHEDULE,
      sourceType: ActivityType.SCHEDULE,
      workItemType: 'opportunity_step',
      status: 'overdue',
      priority: ActivityPriority.HIGH,
      link: '/msp/opportunities/opportunity-1',
    })]);
    // The drawer needs the deal behind the step (the activity id is the
    // step_id): it travels as an 'opportunity' related entity.
    expect(result[0].relatedEntities).toEqual([expect.objectContaining({
      id: 'opportunity-1',
      type: 'opportunity',
    })]);
  });

  it('scopes to owned deals when the feed asks for them, keeping the step assignee', async () => {
    const query = queryReturning([{
      step_id: 'step-2',
      step_title: 'Walk the findings',
      step_status: 'planned',
      due_at: '2999-01-01T12:00:00.000Z',
      assigned_to: 'colleague-9',
      opportunity_id: 'opportunity-2',
      opportunity_number: 'OPP-0002',
      opportunity_title: 'Server refresh',
      client_id: 'client-1',
      client_name: 'Acme',
      created_at: '1999-12-01T12:00:00.000Z',
      updated_at: '1999-12-02T12:00:00.000Z',
    }]);
    const facade = { table: vi.fn(() => query), tenantJoin: vi.fn() };
    mocks.createTenantKnex.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    mocks.tenantDb.mockReturnValue(facade);

    const result = await fetchOpportunityActivities('owner-1', 'tenant-1', { opportunityScope: 'owned' });

    expect(query.where).toHaveBeenCalledWith('o.owner_id', 'owner-1');
    expect(query.where).not.toHaveBeenCalledWith('s.assigned_to', 'owner-1');
    expect(result[0].assignedTo).toEqual(['colleague-9']);
  });

  it("widens to assigned-or-owned for the 'all' scope", async () => {
    const query = queryReturning([{
      step_id: 'step-3',
      step_title: 'Send the proposal',
      step_status: 'current',
      due_at: '2999-01-01T12:00:00.000Z',
      assigned_to: 'owner-1',
      opportunity_id: 'opportunity-3',
      opportunity_number: 'OPP-0003',
      opportunity_title: 'Backup overhaul',
      client_id: 'client-1',
      client_name: 'Acme',
      created_at: '1999-12-01T12:00:00.000Z',
      updated_at: '1999-12-02T12:00:00.000Z',
    }]);
    const facade = { table: vi.fn(() => query), tenantJoin: vi.fn() };
    mocks.createTenantKnex.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    mocks.tenantDb.mockReturnValue(facade);

    const result = await fetchOpportunityActivities('owner-1', 'tenant-1', { opportunityScope: 'all' });

    expect(query.where).toHaveBeenCalledWith('s.assigned_to', 'owner-1');
    expect(query.orWhere).toHaveBeenCalledWith('o.owner_id', 'owner-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('step-3');
  });
});

describe('schedule activity aggregation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drops opportunity_step schedule entries so timed steps are not duplicated in the feed', async () => {
    // A timed step exists both as a schedule entry and as the canonical step
    // activity from fetchOpportunityActivities; only the latter may reach the feed.
    const stepEntry = {
      entry_id: 'entry-step',
      work_item_id: 'step-1',
      work_item_type: 'opportunity_step',
      title: 'Call the decision maker',
      status: 'scheduled',
      scheduled_start: new Date('2999-01-01T12:00:00.000Z'),
      scheduled_end: new Date('2999-01-01T13:00:00.000Z'),
      assigned_user_ids: ['owner-1'],
      is_recurring: false,
      tenant: 'tenant-1',
      created_at: new Date('1999-12-01T12:00:00.000Z'),
      updated_at: new Date('1999-12-02T12:00:00.000Z'),
    };
    const plainEntry = {
      ...stepEntry,
      entry_id: 'entry-plain',
      work_item_id: 'ticket-1',
      work_item_type: 'ticket',
      title: 'On-site visit',
    };
    mocks.getScheduleActivityEntriesForUser.mockResolvedValue([stepEntry, plainEntry]);
    mocks.createTenantKnex.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    // Ad-hoc lookup inside fetchScheduleActivities finds nothing.
    const adHocQuery = queryReturning([]);
    const facade = { table: vi.fn(() => adHocQuery), tenantJoin: vi.fn(() => adHocQuery) };
    mocks.tenantDb.mockReturnValue(facade);

    const result = await fetchScheduleActivities('owner-1', 'tenant-1', {});

    expect(result.map((activity) => activity.id)).toEqual(['entry-plain']);
    expect(result[0].workItemType).toBe('ticket');
  });
});
