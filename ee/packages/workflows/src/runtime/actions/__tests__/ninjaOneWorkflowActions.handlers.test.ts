import { describe, expect, it, vi } from 'vitest';

vi.mock('../ninjaOneWorkflowRuntimeSupport', () => ({
  createNinjaOneWorkflowClient: vi.fn(),
  syncNinjaOneDevice: vi.fn()
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
      name: 'Server 1',
      agent_status: 'online',
      last_seen_at: new Date('2026-05-10T12:00:00.000Z'),
      secret_ref: 'should-not-leak'
    }
  ];

  const assetsBuilder: any = {
    where: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
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

const createActiveIntegrationBuilder = () => ({
  where: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue({ integration_id: 'int-1' })
});

const createInactiveIntegrationBuilder = () => ({
  where: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(undefined)
});

const loadActionById = async (actionId: string) => {
  vi.resetModules();
  const { registerNinjaOneWorkflowActionsV2 } = await import('../registerNinjaOneWorkflowActions');
  const { getActionRegistryV2 } = await import('../../../../../../../shared/workflow/runtime/registries/actionRegistry');
  registerNinjaOneWorkflowActionsV2();
  const action = getActionRegistryV2().listById(actionId)[0];
  expect(action).toBeDefined();
  return action!;
};

describe('NinjaOne workflow action handlers', () => {
  it('T008: ninjaone.devices.find returns normalized local device fields without secret leakage', async () => {
    const action = await loadActionById('ninjaone.devices.find');

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
        hostname: null,
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

  it('T009: ninjaone.devices.sync delegates to sync strategy and returns synced identifiers', async () => {
    const action = await loadActionById('ninjaone.devices.sync');
    const supportModule = await import('../ninjaOneWorkflowRuntimeSupport');
    vi.mocked(supportModule.syncNinjaOneDevice).mockResolvedValue({ asset_id: '550e8400-e29b-41d4-a716-446655440000' });

    const knex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return createActiveIntegrationBuilder();
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await action.handler({ device_id: 123 }, { ...baseCtx, tenantId: 'tenant-1', knex } as any);
    expect(supportModule.syncNinjaOneDevice).toHaveBeenCalledWith({ tenantId: 'tenant-1', integrationId: 'int-1', deviceId: 123 });
    expect(result).toEqual({
      synced: true,
      external_device_id: '123',
      asset_id: '550e8400-e29b-41d4-a716-446655440000'
    });
  });

  it('T010: ninjaone.devices.reboot guards inactive integration and delegates reboot on success', async () => {
    const action = await loadActionById('ninjaone.devices.reboot');
    const supportModule = await import('../ninjaOneWorkflowRuntimeSupport');
    const rebootDevice = vi.fn().mockResolvedValue(undefined);
    vi.mocked(supportModule.createNinjaOneWorkflowClient).mockResolvedValue({ rebootDevice } as any);

    const inactiveKnex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return createInactiveIntegrationBuilder();
      throw new Error(`Unexpected table ${table}`);
    });
    await expect(action.handler({ device_id: 12 }, { ...baseCtx, tenantId: 'tenant-1', knex: inactiveKnex } as any))
      .rejects.toThrow(/not active/i);

    const activeKnex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return createActiveIntegrationBuilder();
      throw new Error(`Unexpected table ${table}`);
    });
    const result = await action.handler({ device_id: 12 }, { ...baseCtx, tenantId: 'tenant-1', knex: activeKnex } as any);
    expect(rebootDevice).toHaveBeenCalledWith(12);
    expect(result).toEqual({ reboot_requested: true, external_device_id: '12' });
  });

  it('T011: ninjaone.alerts.list_active returns normalized active alert fields for ticket mappings', async () => {
    const action = await loadActionById('ninjaone.alerts.list_active');
    const alertsRows = [{
      alert_id: 'a1',
      external_alert_id: 'ext-a1',
      status: 'active',
      severity: 'high',
      message: 'CPU critical',
      external_device_id: 'dev-1',
      asset_id: '550e8400-e29b-41d4-a716-446655440000',
      integration_id: 'int-1',
      triggered_at: new Date('2026-05-10T12:00:00.000Z'),
      updated_at: new Date('2026-05-10T12:10:00.000Z')
    }];
    const alertsBuilder: any = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(alertsRows)
    };
    const knex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return createActiveIntegrationBuilder();
      if (table === 'rmm_alerts') return alertsBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await action.handler({ limit: 10, live: false }, { ...baseCtx, tenantId: 'tenant-1', knex } as any);
    expect(alertsBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-1', integration_id: 'int-1', status: 'active' });
    expect(result.count).toBe(1);
    expect(result.alerts[0]).toMatchObject({
      alert_id: 'a1',
      external_alert_id: 'ext-a1',
      severity: 'high',
      device_id: 'dev-1',
      asset_id: '550e8400-e29b-41d4-a716-446655440000',
      message: 'CPU critical'
    });
  });

  it('T012: ninjaone.alerts.get supports lookup and returns not-found failure when missing', async () => {
    const action = await loadActionById('ninjaone.alerts.get');
    const foundBuilder: any = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ external_alert_id: 'ext-a1', status: 'active', alert_id: 'a1' })
    };
    const foundKnex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return createActiveIntegrationBuilder();
      if (table === 'rmm_alerts') return foundBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    const found = await action.handler({ external_alert_id: 'ext-a1' }, { ...baseCtx, tenantId: 'tenant-1', knex: foundKnex } as any);
    expect(foundBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-1', integration_id: 'int-1', external_alert_id: 'ext-a1' });
    expect(found.alert.external_alert_id).toBe('ext-a1');

    const missingBuilder: any = { where: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(undefined) };
    const missingKnex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return createActiveIntegrationBuilder();
      if (table === 'rmm_alerts') return missingBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    await expect(action.handler({ alert_uid: 'missing' }, { ...baseCtx, tenantId: 'tenant-1', knex: missingKnex } as any))
      .rejects.toThrow(/not found/i);
  });

  it('T013: ninjaone.alerts.reset calls reset operation and returns acknowledged output', async () => {
    const action = await loadActionById('ninjaone.alerts.reset');
    const supportModule = await import('../ninjaOneWorkflowRuntimeSupport');
    const resetAlert = vi.fn().mockResolvedValue(undefined);
    vi.mocked(supportModule.createNinjaOneWorkflowClient).mockResolvedValue({ resetAlert } as any);

    const update = vi.fn().mockResolvedValue(1);
    const alertsBuilder: any = { where: vi.fn().mockReturnThis(), update };
    const knex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return createActiveIntegrationBuilder();
      if (table === 'rmm_alerts') return alertsBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await action.handler({ external_alert_id: 'ext-a1' }, { ...baseCtx, tenantId: 'tenant-1', knex } as any);
    expect(resetAlert).toHaveBeenCalledWith('ext-a1');
    expect(alertsBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-1', integration_id: 'int-1', external_alert_id: 'ext-a1' });
    expect(update).toHaveBeenCalled();
    expect(result).toEqual({ acknowledged: true, alert_id: 'ext-a1' });
  });
});
