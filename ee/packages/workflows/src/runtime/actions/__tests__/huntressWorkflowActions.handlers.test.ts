import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../huntressWorkflowRuntimeSupport', async (importOriginal) => {
  const original = await importOriginal<typeof import('../huntressWorkflowRuntimeSupport')>();
  return {
    ...original,
    createHuntressWorkflowClient: vi.fn()
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
  first: vi.fn().mockResolvedValue({ integration_id: 'int-h', instance_url: 'https://api.huntress.io' })
});

const workflowRunActorBuilder = () => ({
  leftJoin: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue({ matched_workflow_id: 'wf-1', published_by: 'user-1', created_by: null })
});

const permissionBuilder = (allowed = true) => ({
  join: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(allowed ? { permission_id: 'perm-1' } : undefined)
});

const integrationOnlyKnex = (allowed = true): any => {
  const trx: any = vi.fn((table: string) => {
    if (table === 'workflow_runs as wr') return workflowRunActorBuilder();
    if (table === 'user_roles as ur') return permissionBuilder(allowed);
    if (table === 'rmm_integrations') return activeIntegrationBuilder();
    throw new Error(`Unexpected table ${table}`);
  });
  trx.raw = vi.fn().mockResolvedValue(undefined);
  trx.transaction = vi.fn(async (callback) => callback(trx));
  return trx;
};

const loadActionById = async (actionId: string) => {
  vi.resetModules();
  const { registerHuntressWorkflowActionsV2 } = await import('../registerHuntressWorkflowActions');
  const { getActionRegistryV2 } = await import(
    '../../../../../../../shared/workflow/runtime/registries/actionRegistry'
  );
  registerHuntressWorkflowActionsV2();
  const action = getActionRegistryV2().listById(actionId)[0];
  expect(action).toBeDefined();
  return action!;
};

const mockClient = async (client: Record<string, unknown>) => {
  const supportModule = await import('../huntressWorkflowRuntimeSupport');
  vi.mocked(supportModule.createHuntressWorkflowClient).mockResolvedValue(client as any);
  return supportModule;
};

const statusError = (status: number) =>
  Object.assign(new Error(`Huntress API request failed with status ${status}`), { status });

afterEach(() => {
  vi.clearAllMocks();
});

describe('Huntress workflow action handlers (T010)', () => {
  it('incidents.find maps filters through and normalizes reports', async () => {
    const action = await loadActionById('huntress.incidents.find');
    const listIncidentReports = vi.fn().mockResolvedValue([
      {
        id: 421,
        status: 'sent',
        severity: 'critical',
        platform: 'windows',
        summary: 'Foothold detected',
        subject: 'Critical: Foothold on FS-01',
        organization_id: 9,
        agent_id: 77,
        indicator_types: ['footholds'],
        sent_at: '2026-06-11T20:00:00Z',
        closed_at: null,
        updated_at: '2026-06-11T20:05:00Z'
      }
    ]);
    await mockClient({ listIncidentReports });

    const result = await action.handler(
      { status: 'sent', severity: 'critical', organization_id: 9, limit: 25 },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );

    expect(listIncidentReports).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', severity: 'critical', organization_id: 9, limit: 25 })
    );
    expect(result.incidents[0]).toMatchObject({
      incident_id: 421,
      status: 'sent',
      severity: 'critical',
      summary: 'Foothold detected',
      indicator_types: ['footholds']
    });
  });

  it('incidents.get returns the report body for enrichment and maps 404', async () => {
    const action = await loadActionById('huntress.incidents.get');
    const getIncidentReport = vi.fn().mockResolvedValue({
      id: 421,
      status: 'sent',
      severity: 'high',
      body: 'Full SOC narrative…'
    });
    await mockClient({ getIncidentReport });

    const result = await action.handler(
      { incident_id: 421 },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );
    expect(result.body).toBe('Full SOC narrative…');
    expect(result.incident.incident_id).toBe(421);

    getIncidentReport.mockRejectedValueOnce(statusError(404));
    await expect(
      action.handler({ incident_id: 999 }, { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('incidents.resolve posts the resolution and maps the documented failure modes', async () => {
    const action = await loadActionById('huntress.incidents.resolve');
    const resolveIncidentReport = vi.fn().mockResolvedValue({ id: 421, status: 'closed' });
    await mockClient({ resolveIncidentReport });

    const result = await action.handler(
      { incident_id: 421 },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );
    expect(resolveIncidentReport).toHaveBeenCalledWith(421);
    expect(result).toEqual({ resolved: true, incident_id: 421, status: 'closed' });
    expect(action.sideEffectful).toBe(true);

    resolveIncidentReport.mockRejectedValueOnce(statusError(403));
    await expect(
      action.handler({ incident_id: 421 }, { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any)
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('user-based API key')
    });

    resolveIncidentReport.mockRejectedValueOnce(statusError(409));
    await expect(
      action.handler({ incident_id: 421 }, { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any)
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('remediations must be approved')
    });
  });

  it('denies Huntress API access when the workflow actor cannot manage integrations', async () => {
    const action = await loadActionById('huntress.incidents.get');
    const getIncidentReport = vi.fn().mockResolvedValue({ id: 421, status: 'sent', severity: 'high', body: 'secret' });
    await mockClient({ getIncidentReport });

    await expect(
      action.handler(
        { incident_id: 421 },
        { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex(false) } as any
      )
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: settings:update'
    });
    expect(getIncidentReport).not.toHaveBeenCalled();
  });

  it('organizations.list and agents.get normalize reference data', async () => {
    const orgAction = await loadActionById('huntress.organizations.list');
    const listOrganizations = vi.fn().mockResolvedValue([
      { id: 9, name: 'Harborview Dental', agents_count: 42 },
      { id: 10, name: 'Other Org', agents_count: 5 }
    ]);
    await mockClient({ listOrganizations });

    const orgResult = await orgAction.handler(
      { query: 'harbor' },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );
    expect(orgResult.count).toBe(1);
    expect(orgResult.organizations[0]).toEqual({ organization_id: 9, name: 'Harborview Dental', agents_count: 42 });

    const agentAction = await loadActionById('huntress.agents.get');
    const getAgent = vi.fn().mockResolvedValue({
      id: 77,
      hostname: 'FS-01',
      platform: 'windows',
      os: 'Windows Server 2022',
      version: '0.14.20',
      organization_id: 9,
      last_callback_at: '2026-06-12T01:00:00Z',
      ipv4_address: '10.0.0.5'
    });
    await mockClient({ getAgent });

    const agentResult = await agentAction.handler(
      { agent_id: 77 },
      { ...baseCtx, tenantId: 'tenant-1', knex: integrationOnlyKnex() } as any
    );
    expect(agentResult.agent).toMatchObject({ agent_id: 77, hostname: 'FS-01', organization_id: 9 });
  });
});
