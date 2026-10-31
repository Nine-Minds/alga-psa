import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests for the membership-write classifier: create vs update, tenant
// scoping, the line lock, and the refusal text. No database: tenantDb is a
// recording fake whose tables return the rows configured per test.

type Call = { tenant: string; table: string; where?: Record<string, unknown>; forUpdate: boolean };
const calls: Call[] = [];
let rows: Record<string, unknown> = {};
const hasPermission = vi.fn();

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (table: string) => {
      const call: Call = { tenant, table, forUpdate: false };
      calls.push(call);
      const builder: any = {
        where: (w: Record<string, unknown>) => { call.where = w; return builder; },
        forUpdate: () => { call.forUpdate = true; return builder; },
        first: async () => rows[table],
      };
      return builder;
    },
  }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: unknown[]) => hasPermission(...args) }));
vi.mock('@alga-psa/shared/billingClients/templateAmounts', () => ({ deleteTemplateServicePrices: vi.fn() }));
vi.mock('../../../services/contractLineServiceConfigurationService', () => ({ ContractLineServiceConfigurationService: class {} }));
vi.mock('../../contractLineServiceConfigPolicy', () => ({ resolveContractLineServiceConfig: vi.fn() }));
vi.mock('../../../repositories/contractLineRepository', () => ({ fetchCurrencyCatalogRates: vi.fn() }));

import { authorizeMembershipWrite } from '../contractLineMembership';

const trx = {} as any;
const user = { user_id: 'u1' } as any;
const LINE = 'line-1';
const SERVICE = 'svc-1';
const live = { contract_lines: { contract_line_id: LINE }, service_catalog: { service_name: 'Managed Backup' } };

const allow = (...actions: string[]) =>
  hasPermission.mockImplementation(async (_u: unknown, _r: string, action: string) => actions.includes(action));

beforeEach(() => {
  calls.length = 0;
  rows = {};
  hasPermission.mockReset();
});

describe('authorizeMembershipWrite', () => {
  it('requires billing:update when membership and configuration both exist', async () => {
    rows = { ...live, contract_line_services: { service_id: SERVICE }, contract_line_service_configuration: { config_id: 'c1' } };
    allow('update');
    await expect(authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE))
      .resolves.toEqual({ membershipExists: true, configurationExists: true });
    expect(hasPermission).toHaveBeenCalledWith(user, 'billing', 'update', trx);
  });

  it('requires billing:create when the membership row is missing', async () => {
    rows = { ...live };
    allow('update');
    await expect(authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE)).rejects.toThrow(/billing:create/);
    expect(hasPermission).toHaveBeenCalledWith(user, 'billing', 'create', trx);
  });

  it('requires billing:create when only the configuration row is missing', async () => {
    rows = { ...live, contract_line_services: { service_id: SERVICE } };
    allow('update');
    await expect(authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE)).rejects.toThrow(/billing:create/);
    allow('create');
    await expect(authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE))
      .resolves.toEqual({ membershipExists: true, configurationExists: false });
  });

  it('create alone does not authorize modifying existing rows', async () => {
    rows = { ...live, contract_line_services: { service_id: SERVICE }, contract_line_service_configuration: { config_id: 'c1' } };
    allow('create');
    await expect(authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE)).rejects.toThrow(/billing:update/);
  });

  it('refusal keeps the Permission denied: prefix and names the service and permission', async () => {
    rows = { ...live };
    allow();
    const error = await authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message.startsWith('Permission denied:')).toBe(true);
    expect(error.message).toContain('billing:create');
    expect(error.message).toContain('Managed Backup');
    expect(error.message).toContain(SERVICE);
  });

  it('locks the line row FOR UPDATE and scopes every read to the tenant', async () => {
    rows = { ...live, contract_line_services: { service_id: SERVICE }, contract_line_service_configuration: { config_id: 'c1' } };
    allow('update');
    await authorizeMembershipWrite(trx, 'tenant-9', user, LINE, SERVICE);
    expect(calls.every((c) => c.tenant === 'tenant-9')).toBe(true);
    expect(calls[0]).toMatchObject({ table: 'contract_lines', forUpdate: true, where: { contract_line_id: LINE } });
    expect(calls.filter((c) => c.forUpdate)).toHaveLength(1);
    const membership = calls.find((c) => c.table === 'contract_line_services')!;
    expect(membership.where).toEqual({ contract_line_id: LINE, service_id: SERVICE });
  });

  it('classifies template lines from the template membership and configuration tables', async () => {
    rows = {
      contract_template_lines: { template_line_id: LINE },
      contract_template_line_services: { service_id: SERVICE },
      contract_template_line_service_configuration: { config_id: 'c1' },
    };
    allow('update');
    await expect(authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE))
      .resolves.toEqual({ membershipExists: true, configurationExists: true });
    expect(calls.find((c) => c.table === 'contract_template_lines')).toMatchObject({ forUpdate: true });
    expect(calls.find((c) => c.table === 'contract_template_line_services')!.where)
      .toEqual({ template_line_id: LINE, service_id: SERVICE });
  });

  it('fails without a permission check when the line does not exist', async () => {
    await expect(authorizeMembershipWrite(trx, 't1', user, LINE, SERVICE)).rejects.toThrow(/not found/);
    expect(hasPermission).not.toHaveBeenCalled();
  });
});
