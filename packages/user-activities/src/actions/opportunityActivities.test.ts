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
    whereNotNull: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  query.where.mockImplementation((value: unknown) => {
    if (typeof value === 'function') value.call(query);
    return query;
  });
  query.whereNotNull.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe('opportunity activity aggregation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps an owned open opportunity next action to an overdue feed activity with a direct link', async () => {
    const query = queryReturning([{
      opportunity_id: 'opportunity-1',
      opportunity_number: 'OPP-0001',
      opportunity_title: 'Managed services expansion',
      next_action: 'Call the decision maker',
      next_action_due: '2000-01-01T12:00:00.000Z',
      client_id: 'client-1',
      client_name: 'Acme',
      created_at: '1999-12-01T12:00:00.000Z',
      updated_at: '1999-12-02T12:00:00.000Z',
    }]);
    const facade = { table: vi.fn(() => query), tenantJoin: vi.fn() };
    mocks.createTenantKnex.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    mocks.tenantDb.mockReturnValue(facade);

    const result = await fetchOpportunityActivities('owner-1', 'tenant-1', {});

    expect(query.where).toHaveBeenCalledWith({
      'o.owner_id': 'owner-1',
      'o.status': 'open',
    });
    expect(result).toEqual([expect.objectContaining({
      id: 'opportunity-1',
      type: ActivityType.SCHEDULE,
      sourceType: ActivityType.SCHEDULE,
      workItemType: 'opportunity',
      status: 'overdue',
      priority: ActivityPriority.HIGH,
      link: '/msp/opportunities/opportunity-1',
    })]);
  });
});
