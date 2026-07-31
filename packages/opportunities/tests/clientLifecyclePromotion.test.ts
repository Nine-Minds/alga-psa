import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: mocks.tenantDb,
}));

vi.mock('../src/lib/opportunityEvents', () => ({
  publishOpportunityEventAfterCommit: mocks.publish,
}));

import { promoteProspectClientAfterWin } from '../src/lib/clientLifecyclePromotion';

function clientQuery(lifecycleStatus: string) {
  const query: any = {
    where: vi.fn(),
    forUpdate: vi.fn(),
    select: vi.fn(),
    first: vi.fn().mockResolvedValue({ lifecycle_status: lifecycleStatus }),
    update: vi.fn().mockResolvedValue(1),
  };
  query.where.mockReturnValue(query);
  query.forUpdate.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe('won opportunity client promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('promotes a prospect in the caller transaction and emits the lifecycle event', async () => {
    const query = clientQuery('prospect');
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });

    await expect(promoteProspectClientAfterWin(
      {} as any,
      'tenant-1',
      'client-1',
      '2026-07-28T20:00:00.000Z',
    )).resolves.toBe(true);

    expect(query.forUpdate).toHaveBeenCalled();
    expect(query.update).toHaveBeenCalledWith({
      lifecycle_status: 'active',
      updated_at: '2026-07-28T20:00:00.000Z',
    });
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'CLIENT_STATUS_CHANGED',
      {
        clientId: 'client-1',
        previousStatus: 'prospect',
        newStatus: 'active',
        changedAt: '2026-07-28T20:00:00.000Z',
      },
      'client_status_changed:client-1:2026-07-28T20:00:00.000Z',
    );
  });

  it('leaves an already-active client unchanged', async () => {
    const query = clientQuery('active');
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });

    await expect(promoteProspectClientAfterWin(
      {} as any,
      'tenant-1',
      'client-1',
      '2026-07-28T20:00:00.000Z',
    )).resolves.toBe(false);

    expect(query.update).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
