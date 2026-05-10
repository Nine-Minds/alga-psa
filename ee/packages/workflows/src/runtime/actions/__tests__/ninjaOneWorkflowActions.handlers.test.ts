import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../server/src/lib/integrations/ninjaone', () => ({
  createNinjaOneClient: vi.fn()
}));

vi.mock('../../../../../../server/src/lib/integrations/ninjaone/sync/syncStrategy', () => ({
  getNinjaOneSyncStrategy: vi.fn(() => ({ syncDevice: vi.fn() }))
}));

const baseCtx = {
  runId: 'run-1',
  stepPath: 'root.steps[0]',
  idempotencyKey: 'idem-1',
  attempt: 1,
  nowIso: () => new Date().toISOString(),
  env: {}
};

const createKnexForFind = () => {
  const assetsRows = [
    {
      asset_id: '550e8400-e29b-41d4-a716-446655440000',
      rmm_device_id: '123',
      rmm_organization_id: 'org-1',
      hostname: 'srv-1',
      name: 'Server 1',
      last_seen_at: '2026-05-10T12:00:00.000Z',
      secret_ref: 'should-not-leak'
    }
  ];

  const assetsBuilder: any = {
    where: vi.fn().mockReturnThis(),
    modify: vi.fn().mockImplementation((cb: (qb: any) => void) => {
      cb({
        andWhere: vi.fn(),
        andWhereILike: vi.fn(),
        orWhereILike: vi.fn(),
        whereILike: vi.fn(),
        where: vi.fn()
      });
      return assetsBuilder;
    }),
    limit: vi.fn().mockResolvedValue(assetsRows)
  };

  const integrationBuilder: any = {
    where: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ integration_id: 'int-1' })
  };

  const knex: any = vi.fn((table: string) => {
    if (table === 'rmm_integrations') return integrationBuilder;
    if (table === 'assets') return assetsBuilder;
    throw new Error(`Unexpected table ${table}`);
  });

  return knex;
};

describe('NinjaOne workflow action handlers', () => {
  it('T008: ninjaone.devices.find returns normalized local device fields without secret leakage', async () => {
    vi.resetModules();
    const { registerNinjaOneWorkflowActionsV2 } = await import('../registerNinjaOneWorkflowActions');
    const { getActionRegistryV2 } = await import('../../../../../../../shared/workflow/runtime/registries/actionRegistry');

    registerNinjaOneWorkflowActionsV2();
    const action = getActionRegistryV2().listById('ninjaone.devices.find')[0];
    expect(action).toBeDefined();

    const result = await action!.handler(
      { limit: 10, live: false },
      {
        ...baseCtx,
        tenantId: 'tenant-1',
        knex: createKnexForFind()
      } as any
    );

    expect(result.count).toBe(1);
    expect(result.devices).toEqual([
      {
        external_device_id: '123',
        asset_id: '550e8400-e29b-41d4-a716-446655440000',
        organization_id: 'org-1',
        hostname: 'srv-1',
        display_name: 'Server 1',
        dns_name: null,
        agent_online: true,
        last_seen_at: '2026-05-10T12:00:00.000Z',
        os_name: null,
        node_class: null,
        source: 'local'
      }
    ]);
    expect(JSON.stringify(result)).not.toContain('secret_ref');
    expect(JSON.stringify(result)).not.toContain('should-not-leak');
  });
});
