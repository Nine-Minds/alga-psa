import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertMasterTenantAccess: vi.fn(),
  isMasterTenantAuthError: vi.fn((e: unknown) => e instanceof Error && e.message.startsWith('Access denied')),
  logEvent: vi.fn(),
  updateLog: vi.fn(),
  getApplianceTenant: vi.fn(),
  startApplianceWorkflow: vi.fn(),
}));

vi.mock('@ee/lib/auth/masterTenantAccess', () => ({
  assertMasterTenantAccess: mocks.assertMasterTenantAccess,
  isMasterTenantAuthError: mocks.isMasterTenantAuthError,
}));

vi.mock('@ee/lib/platformReports', () => ({
  PlatformReportAuditService: class {
    logEvent = mocks.logEvent;
    updateLog = mocks.updateLog;
  },
  extractClientInfo: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}));

vi.mock('@ee/lib/applianceConsole/algaLicenseAdminClient', () => ({
  getApplianceTenant: mocks.getApplianceTenant,
}));

vi.mock('@ee/lib/applianceConsole/workflowClient', () => ({
  startApplianceWorkflow: mocks.startApplianceWorkflow,
}));

const TENANT = '4ead4fab-a3a5-4803-8905-bc5cd15ca6cb';

function request(body: unknown): any {
  return {
    headers: new Headers(),
    json: async () => body,
  };
}

async function load() {
  const trigger = await import('@ee/lib/applianceConsole/triggerRoute');
  const inputs = await import('@ee/lib/applianceConsole/actionInputs');
  return { ...trigger, ...inputs };
}

describe('handleApplianceTrigger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.assertMasterTenantAccess.mockResolvedValue({ tenantId: 'master', userId: 'u1', userEmail: 'op@nine.test' });
    mocks.getApplianceTenant.mockResolvedValue({ tenant: { company_name: 'Gate House IT' } });
    mocks.logEvent.mockResolvedValue('audit-1');
    mocks.updateLog.mockResolvedValue(undefined);
    mocks.startApplianceWorkflow.mockResolvedValue({ workflowId: `appliance-extend-pro:${TENANT}:audit-1` });
  });

  it('rejects non-master callers with 403 and never writes audit', async () => {
    mocks.assertMasterTenantAccess.mockRejectedValue(new Error('Access denied: master tenant required'));
    const { handleApplianceTrigger, parseExtendPro } = await load();

    const res = await handleApplianceTrigger(
      { action: 'extend-pro', eventType: 'appliance.extend_pro', parse: (b, id, base) => parseExtendPro(b, id!, base) },
      request({}),
      TENANT,
    );

    expect(res.status).toBe(403);
    expect(mocks.logEvent).not.toHaveBeenCalled();
    expect(mocks.startApplianceWorkflow).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid input before any audit row is written', async () => {
    const { handleApplianceTrigger, parseExtendPro } = await load();

    const res = await handleApplianceTrigger(
      { action: 'extend-pro', eventType: 'appliance.extend_pro', parse: (b, id, base) => parseExtendPro(b, id!, base) },
      request({ ends_at: 1, reason: 'x' }),
      TENANT,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ends_at must be in the future/);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant is unknown to C4', async () => {
    mocks.getApplianceTenant.mockResolvedValue(null);
    const { handleApplianceTrigger, parseReissueInstallCode } = await load();

    const res = await handleApplianceTrigger(
      { action: 'reissue-install-code', eventType: 'appliance.reissue_install_code', parse: (b, id, base) => parseReissueInstallCode(b, id!, base) },
      request({}),
      TENANT,
    );

    expect(res.status).toBe(404);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it('writes pending audit, starts the deterministic workflow, marks running, returns 202', async () => {
    const { handleApplianceTrigger, parseExtendPro } = await load();
    const endsAt = Math.floor(Date.now() / 1000) + 14 * 86400;

    const res = await handleApplianceTrigger(
      { action: 'extend-pro', eventType: 'appliance.extend_pro', parse: (b, id, base) => parseExtendPro(b, id!, base) },
      request({ ends_at: endsAt, reason: 'pilot extension', jwt: 'should-not-be-audited' }),
      TENANT,
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      success: true,
      data: { workflow_id: `appliance-extend-pro:${TENANT}:audit-1`, audit_log_id: 'audit-1' },
    });

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'appliance.extend_pro',
        resourceType: 'appliance',
        resourceId: TENANT,
        resourceName: 'Gate House IT',
        status: 'pending',
        details: expect.objectContaining({ action: 'extend-pro', reason: 'pilot extension' }),
      }),
    );
    expect(mocks.logEvent.mock.calls[0][0].details).not.toHaveProperty('jwt');

    expect(mocks.startApplianceWorkflow).toHaveBeenCalledWith({
      action: 'extend-pro',
      tenantId: TENANT,
      auditLogId: 'audit-1',
      args: expect.objectContaining({ tenantId: TENANT, endsAt, seats: null, reason: 'pilot extension', auditLogId: 'audit-1' }),
    });
    expect(mocks.updateLog).toHaveBeenCalledWith('audit-1', { workflowId: `appliance-extend-pro:${TENANT}:audit-1`, status: 'running' });
  });

  it('marks the audit row failed and returns 503 when Temporal cannot start the workflow', async () => {
    mocks.startApplianceWorkflow.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const { handleApplianceTrigger, parseSetStatus } = await load();

    const res = await handleApplianceTrigger(
      { action: 'status', eventType: 'appliance.status', parse: (b, id, base) => parseSetStatus(b, id!, base) },
      request({ status: 'suspended', reason: 'non-payment' }),
      TENANT,
    );

    expect(res.status).toBe(503);
    expect(mocks.updateLog).toHaveBeenCalledWith('audit-1', expect.objectContaining({ status: 'failed' }));
  });

  it('create action runs without a tenant and uses the "new" workflow segment', async () => {
    mocks.startApplianceWorkflow.mockResolvedValue({ workflowId: 'appliance-create:new:audit-1' });
    const { handleApplianceTrigger, parseCreateTenant } = await load();

    const res = await handleApplianceTrigger(
      { action: 'create', eventType: 'appliance.create', parse: (b, _id, base) => parseCreateTenant(b, base) },
      request({ company_name: 'Acme', contact_email: 'ops@acme.test', edition: 'essentials' }),
      null,
    );

    expect(res.status).toBe(202);
    expect(mocks.getApplianceTenant).not.toHaveBeenCalled();
    expect(mocks.startApplianceWorkflow).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', tenantId: 'new' }));
  });
});

describe('action input validation', () => {
  const base = { auditLogId: '', operator: { userId: 'u', userEmail: null } };

  it('paid create needs stripe_sub_id or comp, not both', async () => {
    const { parseCreateTenant, ActionValidationError } = await load();
    expect(() => parseCreateTenant({ company_name: 'A', contact_email: 'a@b.co', edition: 'pro' }, base)).toThrow(ActionValidationError);
    const endsAt = Math.floor(Date.now() / 1000) + 86400;
    expect(() =>
      parseCreateTenant({ company_name: 'A', contact_email: 'a@b.co', edition: 'pro', stripe_sub_id: 'sub_1', comp: { ends_at: endsAt, note: 'n' } }, base),
    ).toThrow(/not both/);
    const ok = parseCreateTenant({ company_name: 'A', contact_email: 'a@b.co', edition: 'pro', comp: { ends_at: endsAt, note: 'pilot' } }, base);
    expect(ok.comp).toEqual({ endsAt, note: 'pilot' });
    expect(ok.productCode).toBe('psa');
  });

  it('caps comp grants at 90 days', async () => {
    const { parseExtendPro } = await load();
    const tooFar = Math.floor(Date.now() / 1000) + 91 * 86400;
    expect(() => parseExtendPro({ ends_at: tooFar, reason: 'r' }, TENANT, base)).toThrow(/within 90 days/);
  });

  it('entitlement change needs a mode and seats', async () => {
    const { parseChangeEntitlement } = await load();
    expect(() => parseChangeEntitlement({ seats: 5, reason: 'r' }, TENANT, base)).toThrow(/mode is required/);
    expect(() => parseChangeEntitlement({ mode: 'comp', reason: 'r' }, TENANT, base)).toThrow(/seats is required/);
    const billed = parseChangeEntitlement({ mode: 'billed', seats: '7', reason: 'r' }, TENANT, base);
    expect(billed).toMatchObject({ mode: 'billed', seats: 7, proration: 'create_prorations' });
    expect(billed).not.toHaveProperty('tier');
    // seats: null is an explicit "unlimited", only meaningful without billing.
    expect(parseChangeEntitlement({ mode: 'comp', seats: null, reason: 'r' }, TENANT, base)).toMatchObject({ seats: null });
    expect(() => parseChangeEntitlement({ mode: 'billed', seats: null, reason: 'r' }, TENANT, base)).toThrow(/Unlimited seats/);
    // There is one paid tier; a `tier` key is ignored rather than accepted.
    const withTier = parseChangeEntitlement({ mode: 'comp', seats: 3, tier: 'premium', reason: 'r' }, TENANT, base);
    expect(withTier).toMatchObject({ mode: 'comp', seats: 3 });
    expect(withTier).not.toHaveProperty('tier');
  });

  it('revoke-appliance validates the appliance id and needs a reason', async () => {
    const { parseRevokeAppliance } = await load();
    expect(() => parseRevokeAppliance({ reason: 'lost' }, TENANT, 'bad id!', base)).toThrow(/Invalid appliance id/);
    expect(() => parseRevokeAppliance({}, TENANT, 'appliance-c785bd0d87e7c470', base)).toThrow(/reason is required/);
    expect(parseRevokeAppliance({ reason: 'lost' }, TENANT, 'appliance-c785bd0d87e7c470', base).applianceId).toBe('appliance-c785bd0d87e7c470');
  });

  it('revoke and activation reissue require a reason', async () => {
    const { parseRevoke, parseReissueActivationCode } = await load();
    expect(() => parseRevoke({}, TENANT, base)).toThrow(/reason is required/);
    expect(parseRevoke({ reason: 'chargeback', hard: 'true' }, TENANT, base).hard).toBe(true);
    expect(() => parseReissueActivationCode({}, TENANT, base)).toThrow(/reason is required/);
  });
});
