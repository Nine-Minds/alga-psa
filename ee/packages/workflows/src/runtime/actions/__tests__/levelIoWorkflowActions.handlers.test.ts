import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../levelIoWorkflowRuntimeSupport', async (importOriginal) => {
  const original = await importOriginal<typeof import('../levelIoWorkflowRuntimeSupport')>();
  return {
    ...original,
    createLevelWorkflowClient: vi.fn()
  };
});

const baseCtx = {
  runId: 'run-1',
  stepPath: 'root.steps[0]',
  idempotencyKey: 'idem-1',
  attempt: 1,
  nowIso: () => new Date().toISOString(),
  env: {}
};

const activeIntegrationBuilder = () => ({
  where: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue({ integration_id: 'int-9' })
});

const integrationOnlyKnex = (): any =>
  vi.fn((table: string) => {
    if (table === 'rmm_integrations') return activeIntegrationBuilder();
    throw new Error(`Unexpected table ${table}`);
  });

const loadActionById = async (actionId: string) => {
  vi.resetModules();
  const { registerLevelIoWorkflowActionsV2 } = await import('../registerLevelIoWorkflowActions');
  const { getActionRegistryV2 } = await import(
    '../../../../../../../shared/workflow/runtime/registries/actionRegistry'
  );
  registerLevelIoWorkflowActionsV2();
  const action = getActionRegistryV2().listById(actionId)[0];
  expect(action).toBeDefined();
  return action!;
};

const mockClient = async (client: Record<string, unknown>) => {
  const supportModule = await import('../levelIoWorkflowRuntimeSupport');
  vi.mocked(supportModule.createLevelWorkflowClient).mockResolvedValue(client as any);
  return supportModule;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Level workflow action handlers (T009)', () => {
  it('devices.find passes the group filter through on live lookups', async () => {
    const action = await loadActionById('levelio.devices.find');
    const listDevices = vi.fn().mockResolvedValue([
      {
        id: 'dev-1',
        hostname: 'reception-pc',
        group_id: 'grp-7',
        online: true,
        platform: 'Windows',
        operating_system: { full_operating_system: 'Windows 11 Pro' },
        security_score: 87,
        last_seen_at: '2026-06-12T01:00:00Z'
      }
    ]);
    await mockClient({ listDevices });

    const assetsBuilder: any = {
      where: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
      modify: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([])
    };
    const knex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return activeIntegrationBuilder();
      if (table === 'assets') return assetsBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await action.handler(
      { group_id: 'grp-7', live: true, limit: 50 },
      { ...baseCtx, tenantId: 'tenant-1', knex } as any
    );

    expect(listDevices).toHaveBeenCalledWith({ groupId: 'grp-7' });
    expect(result.devices[0]).toMatchObject({
      device_id: 'dev-1',
      hostname: 'reception-pc',
      group_id: 'grp-7',
      online: true,
      os_name: 'Windows 11 Pro',
      security_score: 87,
      source: 'levelio'
    });
  });

  it('alerts.resolve posts to Level and marks the local alert row resolved', async () => {
    const action = await loadActionById('levelio.alerts.resolve');
    const resolveAlert = vi.fn().mockResolvedValue(undefined);
    await mockClient({ resolveAlert });

    const update = vi.fn().mockResolvedValue(1);
    const alertsBuilder: any = { where: vi.fn().mockReturnThis(), update };
    const knex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return activeIntegrationBuilder();
      if (table === 'rmm_alerts') return alertsBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await action.handler({ alert_id: 'alert-5' }, { ...baseCtx, tenantId: 'tenant-1', knex } as any);

    expect(resolveAlert).toHaveBeenCalledWith('alert-5');
    expect(alertsBuilder.where).toHaveBeenNthCalledWith(1, 'rmm_alerts.tenant', 'tenant-1');
    expect(alertsBuilder.where).toHaveBeenNthCalledWith(2, {
      integration_id: 'int-9',
      external_alert_id: 'alert-5'
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' }));
    expect(result).toEqual({ resolved: true, alert_id: 'alert-5' });
    expect(action.sideEffectful).toBe(true);
  });

  it('automations.list joins webhooks so trigger tokens are discoverable', async () => {
    const action = await loadActionById('levelio.automations.list');
    const listAutomations = vi.fn().mockResolvedValue([
      { id: 'auto-1', name: 'Restart spooler', description: null, group_id: null, group_name: null },
      { id: 'auto-2', name: 'No webhook automation' }
    ]);
    const listAutomationWebhooks = vi.fn().mockResolvedValue([
      {
        url: 'https://api.level.io/v2/automations/webhooks/tok-abc123',
        automation_id: 'auto-1',
        automation_name: 'Restart spooler',
        requires_authorization_header: true,
        parameters: ['device_ids']
      }
    ]);
    await mockClient({ listAutomations, listAutomationWebhooks });

    const result = await action.handler({}, { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any);

    expect(result.count).toBe(2);
    expect(result.automations[0]).toEqual({
      automation_id: 'auto-1',
      name: 'Restart spooler',
      description: null,
      group_id: null,
      group_name: null,
      webhook_token: 'tok-abc123',
      webhook_requires_authorization: true
    });
    expect(result.automations[1].webhook_token).toBeNull();
  });

  it('automations.trigger passes device_ids and maps 404 to an actionable error', async () => {
    const action = await loadActionById('levelio.automations.trigger');
    const triggerAutomationWebhook = vi.fn().mockResolvedValue(null);
    await mockClient({ triggerAutomationWebhook });

    const result = await action.handler(
      { webhook_token: 'tok-abc123', device_ids: ['dev-1', 'dev-2'] },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );
    expect(triggerAutomationWebhook).toHaveBeenCalledWith('tok-abc123', ['dev-1', 'dev-2']);
    expect(result).toEqual({ triggered: true, webhook_token: 'tok-abc123', vendor_response: null });

    const notFound = Object.assign(new Error('Level API request failed with status 404'), { status: 404 });
    triggerAutomationWebhook.mockRejectedValueOnce(notFound);
    await expect(
      action.handler(
        { webhook_token: 'tok-missing', device_ids: [] },
        { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
      )
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('webhook trigger configured in Level')
    });
  });

  it('automations.run_status normalizes the run and exposes steps only when asked', async () => {
    const action = await loadActionById('levelio.automations.run_status');
    const getAutomationRun = vi.fn().mockResolvedValue({
      id: 'run-9',
      automation_id: 'auto-1',
      automation_name: 'Restart spooler',
      device_id: 'dev-1',
      device_hostname: 'reception-pc',
      status: 'success',
      started_at: '2026-06-12T01:00:00Z',
      ended_at: '2026-06-12T01:00:30Z',
      steps: [{ name: 'step 1', status: 'success' }]
    });
    await mockClient({ getAutomationRun });

    const result = await action.handler(
      { run_id: 'run-9', include_steps: true },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );

    expect(getAutomationRun).toHaveBeenCalledWith('run-9', true);
    expect(result.run).toEqual({
      run_id: 'run-9',
      automation_id: 'auto-1',
      automation_name: 'Restart spooler',
      device_id: 'dev-1',
      device_hostname: 'reception-pc',
      status: 'success',
      started_at: '2026-06-12T01:00:00Z',
      ended_at: '2026-06-12T01:00:30Z'
    });
    expect(result.steps).toEqual([{ name: 'step 1', status: 'success' }]);
  });

  it('updates.list maps Level patch rows', async () => {
    const action = await loadActionById('levelio.updates.list');
    const listUpdates = vi.fn().mockResolvedValue([
      {
        id: 'upd-1',
        device_id: 'dev-1',
        device_hostname: 'reception-pc',
        name: 'KB5031234',
        category: 'security',
        is_available: true,
        installed_on: null
      }
    ]);
    await mockClient({ listUpdates });

    const result = await action.handler(
      { device_id: 'dev-1', status: 'available' },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );

    expect(listUpdates).toHaveBeenCalledWith({ deviceId: 'dev-1', status: 'available' });
    expect(result.updates[0]).toMatchObject({ update_id: 'upd-1', name: 'KB5031234', is_available: true });
  });
});
