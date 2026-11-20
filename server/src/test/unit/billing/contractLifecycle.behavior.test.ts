import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { IContract } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  hasInvoices: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  reactivate: vi.fn(),
  publish: vi.fn(),
  publishNonCatalog: vi.fn(),
  first: vi.fn(),
  select: vi.fn(),
  committed: false,
}));

vi.mock('@alga-psa/billing/models/contract', () => ({ default: {
  getById: mocks.getById,
  hasInvoices: mocks.hasInvoices,
  update: mocks.update,
  delete: mocks.delete,
  checkAndReactivateExpiredContract: mocks.reactivate,
} }));
vi.mock('@alga-psa/billing/models/contractTemplate', () => ({ default: { delete: vi.fn() } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publish,
  publishNonCatalogWorkflowEvent: mocks.publishNonCatalog,
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ first: mocks.first, select: mocks.select }) }) }),
  withTransaction: async (db: Knex, callback: (trx: Knex) => Promise<unknown>) => {
    const result = await callback(db);
    mocks.committed = true;
    return result;
  },
}));

import { deleteContractWithEvents } from '@alga-psa/billing/lib/contractDeletion';
import { updateContractHeaderWithEvents } from '@alga-psa/billing/lib/contractUpdate';

const db = {} as Knex;
const current = {
  contract_id: 'contract-1', owner_client_id: 'client-1', status: 'active',
} as IContract;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.committed = false;
  mocks.first.mockResolvedValue(undefined);
  mocks.getById.mockResolvedValue(current);
  mocks.hasInvoices.mockResolvedValue(false);
  mocks.select.mockResolvedValue([{ client_contract_id: 'assignment-1', client_id: 'client-1' }]);
  mocks.update.mockImplementation(async (_db, _tenant, _id, patch) => ({
    ...current, ...patch, updated_at: '2026-11-05T12:00:00.000Z',
  }));
});

describe('shared UI and API contract lifecycle', () => {
  it('refuses system-managed deletion without deleting or publishing events', async () => {
    mocks.getById.mockResolvedValue({ ...current, is_system_managed_default: true });
    await expect(deleteContractWithEvents(db, 'tenant-1', current.contract_id, 'user-1'))
      .rejects.toMatchObject({ code: 'SYSTEM_MANAGED' });
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.publishNonCatalog).not.toHaveBeenCalled();
  });

  it('refuses manual activation of expired contracts without writing or publishing', async () => {
    await expect(updateContractHeaderWithEvents(db, 'tenant-1', { ...current, status: 'expired' },
      { status: 'active' }, 'user-1')).rejects.toMatchObject({ code: 'EXPIRED_STATUS' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('rechecks expired contracts after an edit and returns their reactivated state', async () => {
    await expect(updateContractHeaderWithEvents(db, 'tenant-1', { ...current, status: 'expired' },
      { contract_name: 'Extended', status: 'expired' }, 'user-1')).resolves.toEqual(current);
    expect(mocks.update).toHaveBeenCalledWith(db, 'tenant-1', current.contract_id, { contract_name: 'Extended' });
    expect(mocks.reactivate).toHaveBeenCalledWith(db, 'tenant-1', current.contract_id);
  });

  it('publishes contract updates with tenant, actor and changed values', async () => {
    await updateContractHeaderWithEvents(db, 'tenant-1', current, { contract_name: 'Renamed' }, 'user-1');
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventType: 'CONTRACT_UPDATED',
      payload: expect.objectContaining({
        contractId: current.contract_id,
        updatedFields: ['contract_name'],
        changes: { contract_name: { previous: null, new: 'Renamed' } },
      }),
      ctx: expect.objectContaining({ tenantId: 'tenant-1', actor: { actorType: 'USER', actorUserId: 'user-1' } }),
    }));
    expect(mocks.update).toHaveBeenCalledWith(db, 'tenant-1', current.contract_id, { contract_name: 'Renamed' });
  });

  it('publishes contract and assignment deletions only after the transaction commits', async () => {
    mocks.publishNonCatalog.mockImplementation(async () => { expect(mocks.committed).toBe(true); });
    await deleteContractWithEvents(db, 'tenant-1', current.contract_id, 'user-1');
    expect(mocks.delete).toHaveBeenCalledWith(db, 'tenant-1', current.contract_id);
    expect(mocks.publishNonCatalog.mock.calls.map(([event]) => event.eventType))
      .toEqual(['CLIENT_CONTRACT_DELETED', 'CONTRACT_DELETED']);
    expect(mocks.publishNonCatalog).toHaveBeenNthCalledWith(1, expect.objectContaining({
      payload: expect.objectContaining({ clientContractId: 'assignment-1', contractId: current.contract_id, clientId: 'client-1' }),
      ctx: expect.objectContaining({ tenantId: 'tenant-1', actor: { actorType: 'USER', actorUserId: 'user-1' } }),
    }));
  });

  it('does not publish deletion events when the transaction fails', async () => {
    mocks.delete.mockRejectedValue(new Error('delete failed'));
    await expect(deleteContractWithEvents(db, 'tenant-1', current.contract_id, 'user-1'))
      .rejects.toThrow('delete failed');
    expect(mocks.committed).toBe(false);
    expect(mocks.publishNonCatalog).not.toHaveBeenCalled();
  });
});
