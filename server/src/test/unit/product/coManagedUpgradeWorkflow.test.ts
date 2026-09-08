import { describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ activities: {} as Record<string, ReturnType<typeof vi.fn>>, query: vi.fn() }));
vi.mock('@temporalio/workflow', () => ({ defineQuery: () => 'status', setHandler: (_: unknown, handler: unknown) => mocks.query(handler),
  log: { info: vi.fn() }, proxyActivities: () => new Proxy({}, { get: (_, name: string) => mocks.activities[name] ??= vi.fn(async () => {}) }) }));
import { tenantProductUpgradeWorkflow } from '../../../../../ee/temporal-workflows/src/workflows/tenant-product-upgrade-workflow';

describe('independent customer upgrade workflow', () => {
  it('uses one atomic activity and exposes progress without any AlgaDesk swap or separate seed/flip steps', async () => {
    let finish!: () => void;
    mocks.activities.product_upgrade_co_managed = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const command = { actor: { kind: 'session' as const, tenant: 'customer', userId: 'admin', sessionId: 'actual-session' },
      target: { customerTenant: 'customer', relationshipId: 'trust' }, request: { operationId: 'operation', expectedRevision: 4 } };
    const result = tenantProductUpgradeWorkflow({ tenantId: 'customer', requestedByUserId: 'admin', coManaged: command });
    expect(mocks.query.mock.calls[0][0]()).toEqual({ currentStep: 'product_upgrade_co_managed', completedSteps: [] });
    expect(mocks.activities.product_upgrade_co_managed).toHaveBeenCalledWith(command);
    finish(); await result;
    expect(mocks.query.mock.calls[0][0]()).toEqual({ currentStep: null, completedSteps: ['product_upgrade_co_managed'] });
    expect(Object.keys(mocks.activities)).toEqual(['product_upgrade_co_managed']);
  });
});
