import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPriority, ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: mocks.tenantDb,
}));

import { fetchOpportunityActivities } from './activityAggregationActions';

function queryReturning(rows: Record<string, unknown>[]) {
  const query: any = {
    where: vi.fn(),
    whereIn: vi.fn(),
    whereNotNull: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  query.where.mockImplementation((value: unknown) => {
    if (typeof value === 'function') value.call(query);
    return query;
  });
  query.whereIn.mockReturnValue(query);
  query.whereNotNull.mockReturnValue(query);
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
});
