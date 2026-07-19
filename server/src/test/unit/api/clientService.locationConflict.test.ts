import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateLocationMock = vi.fn();
const withTransactionMock = vi.fn((_knex: unknown, callback: (trx: unknown) => Promise<unknown>) =>
  callback({ transactionId: 'location-conflict-trx' })
);

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (...args: any[]) => withTransactionMock(...args),
  };
});

vi.mock('@alga-psa/clients/models', () => ({
  createLocation: vi.fn(),
  deleteLocation: vi.fn(),
  updateLocation: (...args: any[]) => updateLocationMock(...args),
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('ClientService location conflict mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a concurrent single-default unique violation to HTTP 409', async () => {
    updateLocationMock.mockRejectedValue({
      code: '23505',
      constraint: 'ux_client_locations_default_per_client',
    });

    const { ClientService } = await import('../../../lib/api/services/ClientService');
    const service = new ClientService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });

    await expect(service.updateLocation(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      { is_default: true },
      { tenant: '33333333-3333-4333-8333-333333333333' } as any,
    )).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Another location is already the default for this client',
    });
  });
});
