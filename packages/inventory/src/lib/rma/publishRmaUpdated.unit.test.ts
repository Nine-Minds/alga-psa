// T030: a publish failure for INVENTORY_RMA_UPDATED is logged and the committed transition stands;
// each transition publishes exactly once after commit.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bus = vi.hoisted(() => ({
  reviveStoredWorkflowPayload: vi.fn((_t: string, p: any) => p),
  publishBuiltWorkflowPayload: vi.fn(async (_p: any) => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));
const db = vi.hoisted(() => ({ committed: [] as string[], order: [] as string[] }));

vi.mock('@alga-psa/event-bus/publishers', () => bus);
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => {
    const out = await fn({});
    db.order.push('commit');
    return out;
  }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string, key?: string) => ({ actionError: message, key }),
  permissionError: (message: string) => ({ permissionError: message }),
}));
vi.mock('@alga-psa/assets/lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => ({})),
  isAssetReadAllowed: vi.fn(async () => true),
}));
vi.mock('@alga-psa/assets/lib/custody/publishCustodyChanged', () => ({ publishCustodyChanged: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/assets/lib/custody/errors', () => ({ isCustodyError: () => false }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildAssetUpdatedPayload: (p: unknown) => p }));

import { publishRmaUpdated } from './publishRmaUpdated';
import { publishAfterCommit, runWarrantyTransition } from './warrantyRunner';

const rma: any = {
  rma_id: '0e7f4c70-0000-4000-8000-000000000001',
  rma_number: 'RMA-00001',
  status: 'awaiting_return',
  rma_type: 'standard',
  asset_id: 'a1b2c3d4-0000-4000-8000-000000000002',
  ticket_id: null,
  client_id: null,
  warranty_outcome: 'covered',
};
const result = (extra: Record<string, unknown> = {}): any => ({
  rma, previousStatus: 'warranty_review', changedFields: ['status'], event: {}, custodyEffects: [], ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  bus.reviveStoredWorkflowPayload.mockImplementation((_t: string, p: any) => p);
  db.order.length = 0;
});

describe('publishRmaUpdated (T030)', () => {
  it('publishes INVENTORY_RMA_UPDATED with the transition facts', async () => {
    await publishRmaUpdated('tenant-1', rma, 'warranty_review', ['status'], 'user-1');
    expect(bus.reviveStoredWorkflowPayload).toHaveBeenCalledTimes(1);
    expect(bus.reviveStoredWorkflowPayload.mock.calls[0][0]).toBe('INVENTORY_RMA_UPDATED');
    const payload = bus.reviveStoredWorkflowPayload.mock.calls[0][1] as any;
    expect(JSON.stringify(payload)).toContain('awaiting_return');
    expect(JSON.stringify(payload)).toContain('warranty_review');
    expect(bus.publishBuiltWorkflowPayload).toHaveBeenCalledTimes(1);
  });

  it('a bus failure is logged, never thrown', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.publishBuiltWorkflowPayload.mockRejectedValueOnce(new Error('bus down'));
    await expect(publishRmaUpdated('tenant-1', rma, 'warranty_review', ['status'], 'user-1')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('INVENTORY_RMA_UPDATED'), expect.any(Error));
    err.mockRestore();
  });

  it('a failing publish does not fail the transition and the result stands (after commit, once)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.publishBuiltWorkflowPayload.mockImplementation(async () => {
      db.order.push('publish');
      throw new Error('bus down');
    });
    const core = vi.fn(async () => result());
    const out = await runWarrantyTransition({ user_id: 'user-1' }, 'tenant-1', core);
    expect(out.rma.status).toBe('awaiting_return');
    expect(core).toHaveBeenCalledTimes(1);
    expect(bus.publishBuiltWorkflowPayload).toHaveBeenCalledTimes(1);
    expect(db.order).toEqual(['commit', 'publish']);
    err.mockRestore();
  });

  it('a core failure publishes nothing', async () => {
    await expect(
      runWarrantyTransition({ user_id: 'user-1' }, 'tenant-1', async () => {
        throw new Error('invalid_transition');
      })
    ).rejects.toThrow('invalid_transition');
    expect(bus.publishBuiltWorkflowPayload).not.toHaveBeenCalled();
  });

  it('exactly one INVENTORY_RMA_UPDATED per transition even with custody and asset effects', async () => {
    await publishAfterCommit('tenant-1', 'user-1', result({
      custodyEffects: [{ custody: {}, eventType: 'x', occurredAt: 'now', assetStatusChange: { assetId: 'a', before: 'x', after: 'y' } }],
      assetEffect: { assetId: 'a', before: {}, after: {}, changedPaths: ['status'] },
    }));
    const updated = bus.reviveStoredWorkflowPayload.mock.calls.filter((c) => c[0] === 'INVENTORY_RMA_UPDATED');
    expect(updated).toHaveLength(1);
    expect(bus.publishBuiltWorkflowPayload).toHaveBeenCalledTimes(1);
  });
});
