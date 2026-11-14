import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { createSeatCatalog, createSeatClient, ensureFixtureTenant, tenantTable } from '../../../../test-utils/perSeatFixtures';

const authState = vi.hoisted(() => ({
  userType: 'internal',
  tenantId: '',
  principalTenantId: '',
  clientId: '',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

let db: Knex;
let tenantId: string;
let clientId: string;
let serviceId: string;
let getContracts: typeof import('@alga-psa/billing/actions/contractActions').getContracts;
let getContractLinesForContract: typeof import('@alga-psa/billing/actions/contractActions').getContractLinesForContract;
let updateContractLineRate: typeof import('@alga-psa/billing/actions/contractActions').updateContractLineRate;
let updateContractLineAssociation: typeof import('@alga-psa/billing/actions/contractActions').updateContractLineAssociation;
let updateMappingAssociation: typeof import('@alga-psa/billing/actions/contractLineMappingActions').updateContractLineAssociation;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;

const withAuthMock = vi.hoisted(() => (action: (...args: any[]) => Promise<unknown>) => (...args: any[]) => action(
    {
      user_id: 'contract-authz-test-user',
      tenant: authState.principalTenantId || authState.tenantId,
      user_type: authState.userType,
      clientId: authState.clientId,
    } as any,
    { tenant: authState.tenantId },
    ...args,
  ));

vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: withAuthMock }));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return { ...createAuthModuleMock(), withAuth: withAuthMock };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, _resource: string, action: string) => {
    if (action === 'read') return authState.canRead;
    if (action === 'create') return authState.canCreate;
    if (action === 'update') return authState.canUpdate;
    if (action === 'delete') return authState.canDelete;
    return false;
  }),
}));

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: authState.tenantId })),
    getCurrentTenantId: vi.fn(async () => authState.tenantId || null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: authState.tenantId })),
    requireTenantId: vi.fn(async () => authState.tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => authState.tenantId || null),
  getTenantFromHeaders: vi.fn(() => authState.tenantId || null),
}));

describe('MSP contract actions authorization boundary', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    delete process.env.E2E_AUTH_BYPASS;
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    authState.tenantId = tenantId;
    setupCommonMocks({ tenantId, userId: 'contract-authz-test-user', permissionCheck: () => true });
    process.env.E2E_AUTH_BYPASS = 'false';
    const [service] = await createSeatCatalog(db, tenantId, [{ name: 'Contract Authz Service', rateCents: 12500 }]);
    serviceId = service.serviceId;
    clientId = (await createSeatClient(db, tenantId)).clientId;
    authState.clientId = clientId;
    const actions = await import('@alga-psa/billing/actions/contractActions');
    const wizard = await import('@alga-psa/billing/actions/contractWizardActions');
    getContracts = actions.getContracts;
    getContractLinesForContract = actions.getContractLinesForContract;
    updateContractLineRate = actions.updateContractLineRate;
    updateContractLineAssociation = actions.updateContractLineAssociation;
    updateMappingAssociation = (await import('@alga-psa/billing/actions/contractLineMappingActions')).updateContractLineAssociation;
    createClientContractFromWizard = wizard.createClientContractFromWizard;
  }, 180_000);

  beforeEach(() => {
    authState.userType = 'internal';
    authState.principalTenantId = tenantId;
    authState.clientId = clientId;
    authState.canRead = authState.canCreate = authState.canUpdate = authState.canDelete = true;
    process.env.E2E_AUTH_BYPASS = 'false';
    setupCommonMocks({ tenantId, userId: 'contract-authz-test-user', permissionCheck: () => true });
  });

  afterAll(async () => {
    await db?.destroy();
  }, 180_000);

  async function seedContract() {
    authState.userType = 'internal';
    const result = await createClientContractFromWizard({
      contract_name: `Contract authz ${uuidv4().slice(0, 8)}`,
      client_id: clientId,
      start_date: '2025-02-01',
      end_date: '2026-12-31',
      billing_frequency: 'monthly',
      billing_timing: 'advance',
      enable_proration: false,
      fixed_services: [{ service_id: serviceId, pricing_basis: 'unit', quantity: 1, unit_rate: 12500 }],
      hourly_services: [],
      usage_services: [],
    } as any) as any;
    expect(result).not.toHaveProperty('actionError');
    const line = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract_id }).first('contract_line_id');
    if (!line) throw new Error('Expected the created contract to have a contract line.');
    await tenantTable(db, tenantId, 'contract_lines')
      .where({ contract_line_id: line.contract_line_id })
      .update({ custom_rate: 12500, rate_provenance: 'custom' });
    return { contractId: result.contract_id as string, lineId: line.contract_line_id as string };
  }

  async function lineState(lineId: string) {
    return tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: lineId })
      .first('custom_rate', 'billing_timing', 'invoice_line_description', 'rate_provenance');
  }

  const rateMutations = [
    { name: 'rate action', mutate: (contractId: string, lineId: string, rate: number) => updateContractLineRate(contractId, lineId, rate) },
    { name: 'contract association action', mutate: (contractId: string, lineId: string, rate: number) => updateContractLineAssociation(contractId, lineId, { custom_rate: rate }) },
    { name: 'mapping association action', mutate: (contractId: string, lineId: string, rate: number) => updateMappingAssociation(contractId, lineId, { custom_rate: rate }) },
  ];

  it.each(rateMutations)('$name refuses a different client before any rate or synchronization writes', async ({ mutate }) => {
    const { contractId, lineId } = await seedContract();
    const callerClientId = (await createSeatClient(db, tenantId)).clientId;
    const contract = await tenantTable(db, tenantId, 'contracts').where({ contract_id: contractId }).first('owner_client_id');
    expect(contract.owner_client_id).toBe(clientId);
    expect(callerClientId).not.toBe(contract.owner_client_id);
    const beforeLine = await lineState(lineId);
    const beforePeriods = await tenantTable(db, tenantId, 'recurring_service_periods').where({ obligation_id: lineId }).select('*');
    const beforeIssuances = await tenantTable(db, tenantId, 'contract_line_block_issuances').where({ contract_line_id: lineId }).select('*');

    authState.userType = 'client';
    authState.clientId = callerClientId;
    expect(await mutate(contractId, lineId, 1)).toHaveProperty('permissionError', 'Permission denied: Contract is outside your client scope.');
    expect(await lineState(lineId)).toEqual(beforeLine);
    expect(await tenantTable(db, tenantId, 'recurring_service_periods').where({ obligation_id: lineId }).select('*')).toEqual(beforePeriods);
    expect(await tenantTable(db, tenantId, 'contract_line_block_issuances').where({ contract_line_id: lineId }).select('*')).toEqual(beforeIssuances);
  }, 180_000);

  it.each(rateMutations)('$name refuses even the owning client principal', async ({ mutate }) => {
    const { contractId, lineId } = await seedContract();
    const before = await lineState(lineId);
    authState.userType = 'client';
    expect(authState.clientId).toBe(clientId);
    expect(await mutate(contractId, lineId, 1)).toHaveProperty('permissionError');
    expect(await lineState(lineId)).toEqual(before);
  }, 180_000);

  it.each(rateMutations)('$name refuses an MSP principal from a different tenant even with auth bypass', async ({ mutate }) => {
    const { contractId, lineId } = await seedContract();
    const before = await lineState(lineId);
    authState.principalTenantId = uuidv4();
    process.env.E2E_AUTH_BYPASS = 'true';
    expect(await mutate(contractId, lineId, 1)).toHaveProperty('permissionError');
    expect(await lineState(lineId)).toEqual(before);
  }, 180_000);

  it.each(rateMutations)('$name requires billing:update and permits a tenant-matched MSP', async ({ mutate }) => {
    const { contractId, lineId } = await seedContract();
    const before = await lineState(lineId);
    setupCommonMocks({ tenantId, userId: 'contract-authz-test-user', permissionCheck: () => false });
    authState.canUpdate = false;
    expect(await mutate(contractId, lineId, 1)).toHaveProperty('permissionError');
    expect(await lineState(lineId)).toEqual(before);

    authState.canUpdate = true;
    setupCommonMocks({ tenantId, userId: 'contract-authz-test-user', permissionCheck: () => true });
    const allowed = await mutate(contractId, lineId, 14900);
    if (allowed !== undefined) {
      expect(allowed).not.toHaveProperty('permissionError');
      expect(allowed).not.toHaveProperty('actionError');
    }
    expect(Number((await lineState(lineId))?.custom_rate)).toBe(14900);
  }, 180_000);

  it.each(rateMutations)('$name keeps templates MSP-only and permits authorized MSP template rates', async ({ mutate }) => {
    const templateId = uuidv4();
    const templateLineId = uuidv4();
    await tenantTable(db, tenantId, 'contract_templates').insert({
      tenant: tenantId, template_id: templateId, template_name: `Authz template ${templateId}`, currency_code: 'USD',
    });
    await tenantTable(db, tenantId, 'contract_template_lines').insert({
      tenant: tenantId, template_id: templateId, template_line_id: templateLineId, template_line_name: 'Authz template line',
      billing_frequency: 'monthly', line_type: 'Fixed', custom_rate: 12500, display_order: 0,
    });
    const readTemplateLine = () => tenantTable(db, tenantId, 'contract_template_lines')
      .where({ template_line_id: templateLineId }).first('*');
    const before = await readTemplateLine();
    authState.userType = 'client';
    expect(await mutate(templateId, templateLineId, 1)).toHaveProperty('permissionError');
    expect(await readTemplateLine()).toEqual(before);

    authState.userType = 'internal';
    const allowed = await mutate(templateId, templateLineId, 14900);
    if (allowed !== undefined) expect(allowed).not.toHaveProperty('actionError');
    expect(Number((await readTemplateLine()).custom_rate)).toBe(14900);
  }, 180_000);

  it('denies client Admin enumeration and rate changes before billing permission grants or sync work', async () => {
    const { contractId, lineId } = await seedContract();
    const beforeLine = await lineState(lineId);
    const beforePeriods = await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({ tenant: tenantId, obligation_id: lineId }).select('*');
    const beforeIssuances = await tenantTable(db, tenantId, 'contract_line_block_issuances')
      .where({ tenant: tenantId, contract_line_id: lineId }).select('*');

    authState.userType = 'client';
    authState.canRead = true;
    authState.canUpdate = true;
    const allContracts = await getContracts();
    const lines = await getContractLinesForContract(contractId);
    expect(allContracts).toHaveProperty('permissionError');
    expect(lines).toHaveProperty('permissionError');

    const denied = await updateContractLineRate(contractId, lineId, 9900, 'arrears', 'tampered description');
    expect(denied).toHaveProperty('permissionError');
    expect(denied).toHaveProperty('messageKey', 'msp/contracts:errors.permissions.modifyLines');
    expect(await lineState(lineId)).toEqual(beforeLine);
    expect(await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({ tenant: tenantId, obligation_id: lineId }).select('*')).toEqual(beforePeriods);
    expect(await tenantTable(db, tenantId, 'contract_line_block_issuances')
      .where({ tenant: tenantId, contract_line_id: lineId }).select('*')).toEqual(beforeIssuances);
  }, 180_000);

  it('keeps the MSP principal boundary when E2E_AUTH_BYPASS skips billing permissions', async () => {
    const { contractId, lineId } = await seedContract();
    const before = await lineState(lineId);
    const hasPermission = await import('@alga-psa/auth/rbac').then((module) => module.hasPermission);
    const permissionSpy = vi.mocked(hasPermission);
    permissionSpy.mockClear();

    process.env.E2E_AUTH_BYPASS = 'true';
    authState.userType = 'client';
    const denied = await updateContractLineRate(contractId, lineId, 16700);
    expect(denied).toHaveProperty('permissionError');
    expect(permissionSpy).not.toHaveBeenCalled();
    expect(await lineState(lineId)).toEqual(before);

    authState.userType = 'internal';
    authState.canUpdate = false;
    const allowed = await updateContractLineRate(contractId, lineId, 16700);
    expect(allowed).toBeUndefined();
    const updatedLine = await lineState(lineId);
    if (!updatedLine) throw new Error('Expected the updated contract line to remain available.');
    expect(Number(updatedLine.custom_rate)).toBe(16700);
    process.env.E2E_AUTH_BYPASS = 'false';
  }, 180_000);

  it('allows MSP billing admins and denies MSP users without the required permission', async () => {
    const { contractId, lineId } = await seedContract();
    const before = await lineState(lineId);
    process.env.E2E_AUTH_BYPASS = 'false';
    authState.userType = 'internal';
    authState.canRead = true;
    const contracts = await getContracts();
    expect(Array.isArray(contracts)).toBe(true);
    expect((contracts as any[]).some((contract) => contract.contract_id === contractId)).toBe(true);

    authState.canUpdate = false;
    setupCommonMocks({ tenantId, userId: 'contract-authz-test-user', permissionCheck: (_user, _resource, action) => action !== 'update' });
    const { hasPermission } = await import('@alga-psa/auth/rbac');
    expect(await hasPermission({} as any, 'billing', 'update')).toBe(false);
    expect(await updateContractLineRate(contractId, lineId, 13800)).toHaveProperty('permissionError');
    expect(await lineState(lineId)).toEqual(before);

    authState.canUpdate = true;
    setupCommonMocks({ tenantId, userId: 'contract-authz-test-user', permissionCheck: () => true });
    const updated = await updateContractLineRate(contractId, lineId, 13800, 'arrears', 'Authorized update');
    expect(updated).toBeUndefined();
    const updatedLine = await lineState(lineId);
    if (!updatedLine) throw new Error('Expected the updated contract line to remain available.');
    expect(Number(updatedLine.custom_rate)).toBe(13800);
    expect(updatedLine.billing_timing).toBe('arrears');
    expect(updatedLine.invoice_line_description).toBe('Authorized update');
  }, 180_000);

  it.each(rateMutations)('$name rejects unrelated and unknown tenant line identifiers without mutating or synchronizing', async ({ mutate }) => {
    const contractA = await seedContract();
    const contractB = await seedContract();
    authState.userType = 'internal';
    const before = await lineState(contractB.lineId);
    expect(await mutate(contractA.contractId, contractB.lineId, 1)).toHaveProperty('actionError');
    expect(await mutate(contractA.contractId, uuidv4(), 1)).toHaveProperty('actionError');
    expect(await lineState(contractB.lineId)).toEqual(before);
  }, 180_000);
});
