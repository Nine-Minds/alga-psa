import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tacticalRmmWorkflowRuntimeSupport', async (importOriginal) => {
  const original = await importOriginal<typeof import('../tacticalRmmWorkflowRuntimeSupport')>();
  return {
    ...original,
    createTacticalWorkflowClient: vi.fn()
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
  first: vi.fn().mockResolvedValue({
    integration_id: 'int-7',
    instance_url: 'https://api.tactical.example.com',
    settings: { auth_mode: 'api_key' }
  })
});

const inactiveIntegrationBuilder = () => ({
  where: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(undefined)
});

const integrationOnlyKnex = (builderFactory = activeIntegrationBuilder): any =>
  vi.fn((table: string) => {
    if (table === 'rmm_integrations') return builderFactory();
    throw new Error(`Unexpected table ${table}`);
  });

const chainBuilder = (firstValue: unknown) => ({
  leftJoin: vi.fn().mockReturnThis(),
  join: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  whereRaw: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(firstValue)
});

const tacticalKnexWithPermission = (permissionGranted = true): any => {
  const trx: any = vi.fn((table: string) => {
    if (table.startsWith('workflow_runs')) return chainBuilder({ matched_workflow_id: 'workflow-1', published_by: 'user-1' });
    if (table.startsWith('user_roles')) return chainBuilder(permissionGranted ? { permission_id: 'perm-1' } : undefined);
    throw new Error(`Unexpected transaction table ${table}`);
  });
  trx.raw = vi.fn().mockResolvedValue(undefined);

  const knex: any = vi.fn((table: string) => {
    if (table === 'rmm_integrations') return activeIntegrationBuilder();
    throw new Error(`Unexpected table ${table}`);
  });
  knex.transaction = vi.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(trx));
  return knex;
};

const loadActionById = async (actionId: string) => {
  vi.resetModules();
  const { registerTacticalRmmWorkflowActionsV2 } = await import('../registerTacticalRmmWorkflowActions');
  const { getActionRegistryV2 } = await import(
    '../../../../../../../shared/workflow/runtime/registries/actionRegistry'
  );
  registerTacticalRmmWorkflowActionsV2();
  const action = getActionRegistryV2().listById(actionId)[0];
  expect(action).toBeDefined();
  return action!;
};

const mockClient = async (client: Record<string, unknown>) => {
  const supportModule = await import('../tacticalRmmWorkflowRuntimeSupport');
  vi.mocked(supportModule.createTacticalWorkflowClient).mockResolvedValue(client as any);
  return supportModule;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Tactical RMM workflow action handlers (T007)', () => {
  it('agents.find maps synced assets in local mode', async () => {
    const action = await loadActionById('tacticalrmm.agents.find');
    const assetsRows = [
      {
        asset_id: '550e8400-e29b-41d4-a716-446655440000',
        rmm_device_id: 'agent-abc',
        rmm_organization_id: 'org-3',
        name: 'FS-01',
        agent_status: 'online',
        last_seen_at: new Date('2026-06-01T08:00:00.000Z')
      }
    ];
    const assetsBuilder: any = {
      where: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
      modify: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(assetsRows)
    };
    const knex: any = vi.fn((table: string) => {
      if (table === 'rmm_integrations') return activeIntegrationBuilder();
      if (table === 'assets') return assetsBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await action.handler({ limit: 10, live: false }, { ...baseCtx, tenantId: 'tenant-1', knex } as any);

    expect(result.count).toBe(1);
    expect(result.agents[0]).toEqual({
      agent_id: 'agent-abc',
      asset_id: '550e8400-e29b-41d4-a716-446655440000',
      hostname: 'FS-01',
      organization_id: 'org-3',
      agent_online: true,
      last_seen_at: '2026-06-01T08:00:00.000Z',
      os_name: null,
      source: 'local'
    });
  });

  it('agents.get fetches live agent detail and normalizes it', async () => {
    const action = await loadActionById('tacticalrmm.agents.get');
    const getAgent = vi.fn().mockResolvedValue({
      agent_id: 'agent-abc',
      hostname: 'FS-01',
      client_id: 3,
      status: 'overdue',
      last_seen: '2026-06-11T22:10:00Z',
      operating_system: 'Windows 11 Pro'
    });
    await mockClient({ getAgent });

    const result = await action.handler(
      { agent_id: 'agent-abc' },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );

    expect(getAgent).toHaveBeenCalledWith('agent-abc');
    expect(result.agent).toMatchObject({
      agent_id: 'agent-abc',
      hostname: 'FS-01',
      organization_id: '3',
      agent_online: false,
      os_name: 'Windows 11 Pro',
      source: 'tacticalrmm'
    });
  });

  it('scripts.list returns id, name, and shell so run_script inputs are discoverable', async () => {
    const action = await loadActionById('tacticalrmm.scripts.list');
    const listScripts = vi.fn().mockResolvedValue([
      { id: 89, name: 'Clear print spooler', shell: 'powershell', category: 'Maintenance', description: 'Clears stuck jobs' },
      { id: 90, name: 'Disk cleanup', shell: 'cmd', category: null }
    ]);
    await mockClient({ listScripts });

    const result = await action.handler(
      { query: 'clear' },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );

    expect(result.count).toBe(1);
    expect(result.scripts[0]).toEqual({
      id: 89,
      name: 'Clear print spooler',
      shell: 'powershell',
      category: 'Maintenance',
      description: 'Clears stuck jobs'
    });
  });

  it('run_script forwards script/args/timeout and returns the captured output', async () => {
    const action = await loadActionById('tacticalrmm.agents.run_script');
    const runScript = vi.fn().mockResolvedValue('C: freed 4.2 GB');
    await mockClient({ runScript });

    const result = await action.handler(
      { agent_id: 'agent-abc', script_id: 89, args: ['-Force'], timeout: 120, run_as_user: false, wait_for_output: true },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );

    expect(runScript).toHaveBeenCalledWith('agent-abc', {
      script: 89,
      args: ['-Force'],
      timeout: 120,
      run_as_user: false,
      output: 'wait'
    });
    expect(result).toEqual({
      run_requested: true,
      agent_id: 'agent-abc',
      output: 'C: freed 4.2 GB',
      vendor_response: 'C: freed 4.2 GB'
    });
  });

  it('run_command requires explicit RMM command permission and surfaces command output', async () => {
    const runAction = await loadActionById('tacticalrmm.agents.run_command');
    const runCommand = vi.fn().mockResolvedValue({ output: 'pong' });
    await mockClient({ runCommand });

    const runResult = await runAction.handler(
      { agent_id: 'agent-abc', command: 'ping -n 1 host', shell: 'cmd', timeout: 30, run_as_user: false },
      { ...baseCtx, tenantId: 'tenant-1', knex: tacticalKnexWithPermission(true) } as any
    );
    expect(runCommand).toHaveBeenCalledWith('agent-abc', {
      shell: 'cmd',
      cmd: 'ping -n 1 host',
      timeout: 30,
      run_as_user: false
    });
    expect(runResult.output).toBe('pong');
    expect(runAction.sideEffectful).toBe(true);
  });

  it('run_command denies workflow actors without the RMM command permission before calling Tactical RMM', async () => {
    const runAction = await loadActionById('tacticalrmm.agents.run_command');
    const runCommand = vi.fn().mockResolvedValue({ output: 'pong' });
    await mockClient({ runCommand });

    await expect(
      runAction.handler(
        { agent_id: 'agent-abc', command: 'whoami', shell: 'cmd', timeout: 30, run_as_user: false },
        { ...baseCtx, tenantId: 'tenant-1', knex: tacticalKnexWithPermission(false) } as any
      )
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: rmm:execute_command'
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('reboot marks side effects', async () => {
    const rebootAction = await loadActionById('tacticalrmm.agents.reboot');
    const rebootAgent = vi.fn().mockResolvedValue(undefined);
    await mockClient({ rebootAgent });

    const rebootResult = await rebootAction.handler(
      { agent_id: 'agent-abc' },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );
    expect(rebootAgent).toHaveBeenCalledWith('agent-abc');
    expect(rebootResult).toEqual({ reboot_requested: true, agent_id: 'agent-abc' });
    expect(rebootAction.sideEffectful).toBe(true);
  });

  it('yields an actionable error when the integration is not connected', async () => {
    const action = await loadActionById('tacticalrmm.agents.run_script');

    await expect(
      action.handler(
        { agent_id: 'agent-abc', script_id: 89 },
        { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex(inactiveIntegrationBuilder) } as any
      )
    ).rejects.toMatchObject({
      code: 'INTEGRATION_INACTIVE',
      message: expect.stringContaining('Settings > Integrations > RMM')
    });
  });
});
