import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import {
  getContractLineEditVersion,
  saveContractLineEdit,
  type ContractLineEditDraft,
} from '../contractLineSaveAction';
import { ContractLineServiceConfigurationService } from '../../services/contractLineServiceConfigurationService';

// Guarded DB test (real schema) for membership-write authorization in
// saveContractLineEdit (card f2aac11d). Authorization comes from the rows the
// transaction writes, never from the request's declared service list.
// Runs in the workspace-db lane (hence the .db.test.ts name); same opt-in and
// connection contract as tests/contractLineSave.db.test.ts.

const enabled = process.env.CONTRACT_LINE_SAVE_DB_TESTS === '1';

const config = {
  host: process.env.CONTRACT_LINE_SAVE_DB_HOST || '127.0.0.1',
  port: Number(process.env.CONTRACT_LINE_SAVE_DB_PORT || 6472),
  user: process.env.CONTRACT_LINE_SAVE_DB_USER || 'app_user',
  password: process.env.CONTRACT_LINE_SAVE_DB_PASSWORD || '',
  database: process.env.CONTRACT_LINE_SAVE_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;
let userId: string;
let typeOrder = 0;
// The caller's effective permissions, as `resource:action`.
let granted = new Set<string>();
let runWithTenantCtxBase: <T>(t: string, fn: () => Promise<T>) => Promise<T>;
let runWithTenantCtx: <T>(fn: () => Promise<T>) => Promise<T>;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => runWithTenantCtx(() => fn({ user_id: userId }, { tenant }, ...args)),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) => granted.has(`${resource}:${action}`)),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: db })) };
});
vi.mock('../../lib/authHelpers', () => ({
  getAnalyticsAsync: async () => ({
    analytics: { capture: vi.fn() },
    AnalyticsEvents: { BILLING_RULE_UPDATED: 'billing_rule_updated' },
  }),
}));
vi.mock('../recurringServicePeriodSync', () => ({
  syncRecurringServicePeriodsForContractLine: vi.fn(async () => undefined),
}));
vi.mock('../../services/prepaidBlockIssuanceSync', () => ({
  syncPrepaidBlockIssuancesForContractLine: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
}));

const UPDATE_ONLY = ['billing:read', 'billing:update'];
const CREATE_AND_UPDATE = ['billing:read', 'billing:create', 'billing:update'];
const OVERLAY = { total_minutes: 120, overage_rate: 7500, billing_period: 'monthly' as const };

describe.runIf(enabled)('saveContractLineEdit: membership writes are authorized from effective state', () => {
  let lineId: string;
  let attachedServiceId: string;
  let unattachedServiceId: string;

  beforeAll(async () => {
    ({ runWithTenant: runWithTenantCtxBase } = await import('@alga-psa/db') as any);
    runWithTenantCtx = (fn) => runWithTenantCtxBase(tenant, fn);
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 3 } });
    tenant = uuidv4();
    userId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'CL Authz Tenant', email: 'clauthz@test.local', billing_source: 'test' });
  });

  afterAll(async () => {
    await cleanupTenantRows();
    await db('tenants').where({ tenant }).delete();
    await db.destroy();
  });

  async function cleanupTenantRows() {
    for (const table of [
      'contract_line_bucket_services',
      'contract_line_buckets',
      'contract_line_service_fixed_config',
      'contract_line_service_configuration',
      'contract_line_services',
      'contract_lines',
      'contracts',
      'service_catalog',
      'service_types',
      'clients',
    ]) {
      await db(table).where({ tenant }).delete();
    }
  }

  async function seedService(name: string): Promise<string> {
    const typeId = uuidv4();
    const serviceId = uuidv4();
    await db('service_types').insert({ id: typeId, tenant, name: `${name} type`, is_active: true, order_number: ++typeOrder });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: name, custom_service_type_id: typeId,
      billing_method: 'fixed', default_rate: 10000, unit_of_measure: 'each',
      category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    return serviceId;
  }

  beforeEach(async () => {
    await cleanupTenantRows();
    typeOrder = 0;
    const clientId = uuidv4();
    const contractId = uuidv4();
    lineId = uuidv4();
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'CL Authz Client' });
    await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'CL Authz Contract', owner_client_id: clientId });
    await db('contract_lines').insert({
      tenant, contract_line_id: lineId, contract_line_name: 'CL Authz Line', contract_id: contractId,
      contract_line_type: 'Fixed', billing_frequency: 'monthly', billing_timing: 'arrears',
      cadence_owner: 'client', is_active: true,
    });
    attachedServiceId = await seedService('Attached Svc');
    unattachedServiceId = await seedService('Unattached Svc');
    await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: attachedServiceId });
    await runWithTenantCtx(async () => new ContractLineServiceConfigurationService(db, tenant).createConfiguration(
      { tenant, contract_line_id: lineId, service_id: attachedServiceId, configuration_type: 'Fixed', quantity: 1 } as any,
      { base_rate: 1000, base_rate_basis: 'per_unit' } as any,
    ));
    granted = new Set(UPDATE_ONLY);
  });

  async function rowCounts() {
    const count = async (table: string, where: Record<string, unknown> = {}) =>
      Number((await db(table).where({ tenant, ...where }).count('* as n').first())!.n);
    return {
      memberships: await count('contract_line_services'),
      unattachedMemberships: await count('contract_line_services', { service_id: unattachedServiceId }),
      configurations: await count('contract_line_service_configuration'),
      buckets: await count('contract_line_buckets'),
      bucketServices: await count('contract_line_bucket_services'),
    };
  }

  const draft = async (over: Partial<ContractLineEditDraft> = {}): Promise<ContractLineEditDraft> => {
    const v = await getContractLineEditVersion(lineId);
    expect(typeof v).toBe('string');
    return {
      line: {}, members: [], removed_config_ids: [], added_service_ids: [], removed_service_ids: [],
      bucket_overlays: [], effective_boundary: null, expected_version: v as string, ...over,
    };
  };

  const refused = (result: unknown, permission: string) => {
    expect(result).not.toMatchObject({ status: 'saved' });
    const text = JSON.stringify(result);
    expect(text).toContain('Permission denied');
    expect(text).toContain(permission);
  };

  it('1. update-only user + overlay for an unattached service is refused and writes nothing', async () => {
    const before = await rowCounts();
    const result = await saveContractLineEdit(lineId, await draft({
      added_service_ids: [],
      bucket_overlays: [{ service_id: unattachedServiceId, overlay: OVERLAY }],
    }));
    refused(result, 'billing:create');
    expect(await rowCounts()).toEqual(before);
    expect(before.unattachedMemberships).toBe(0);
  });

  it('2. update-only user + overlay for an attached service succeeds without touching membership', async () => {
    const before = await rowCounts();
    const result = await saveContractLineEdit(lineId, await draft({
      bucket_overlays: [{ service_id: attachedServiceId, overlay: OVERLAY }],
    }));
    expect(result).toMatchObject({ status: 'saved' });
    const after = await rowCounts();
    expect(after.memberships).toBe(before.memberships);
    expect(after.configurations).toBe(before.configurations);
    expect(after.buckets).toBe(1);
    expect(after.bucketServices).toBe(1);
  });

  it('3. a user with create and update + overlay for an unattached service writes membership and bucket rows', async () => {
    // The overlay loop independently requires billing:update, so "create-only" cannot reach the helper.
    granted = new Set(CREATE_AND_UPDATE);
    const result = await saveContractLineEdit(lineId, await draft({
      bucket_overlays: [{ service_id: unattachedServiceId, overlay: OVERLAY }],
    }));
    expect(result).toMatchObject({ status: 'saved' });
    const after = await rowCounts();
    expect(after.unattachedMemberships).toBe(1);
    expect(after.buckets).toBe(1);
    expect(after.bucketServices).toBe(1);
  });

  it('4. a user without create is still refused when added_service_ids is non-empty', async () => {
    const before = await rowCounts();
    const result = await saveContractLineEdit(lineId, await draft({
      members: [{ service_id: unattachedServiceId, configuration_type: 'Fixed', quantity: 1, base_rate: 2500 }],
      added_service_ids: [unattachedServiceId],
    }));
    refused(result, 'billing:create');
    expect(await rowCounts()).toEqual(before);
  });

  it('5. a second save sees the first save\'s membership and needs only update', async () => {
    granted = new Set(CREATE_AND_UPDATE);
    const first = await saveContractLineEdit(lineId, await draft({
      members: [{ service_id: unattachedServiceId, configuration_type: 'Fixed', quantity: 1, base_rate: 2500 }],
      added_service_ids: [unattachedServiceId],
    }));
    expect(first).toMatchObject({ status: 'saved' });
    expect((await rowCounts()).unattachedMemberships).toBe(1);

    granted = new Set(UPDATE_ONLY);
    const second = await saveContractLineEdit(lineId, await draft({
      bucket_overlays: [{ service_id: unattachedServiceId, overlay: OVERLAY }],
    }));
    expect(second).toMatchObject({ status: 'saved' });
    const after = await rowCounts();
    expect(after.unattachedMemberships).toBe(1); // no double-create
    expect(after.configurations).toBe(2);
  });

  it('5b. a membership attached by an overlay (no configuration row) still needs create for the next overlay', async () => {
    granted = new Set(CREATE_AND_UPDATE);
    const first = await saveContractLineEdit(lineId, await draft({
      bucket_overlays: [{ service_id: unattachedServiceId, overlay: OVERLAY }],
    }));
    expect(first).toMatchObject({ status: 'saved' });

    granted = new Set(UPDATE_ONLY);
    const before = await rowCounts();
    const second = await saveContractLineEdit(lineId, await draft({
      bucket_overlays: [{ service_id: unattachedServiceId, overlay: { ...OVERLAY, total_minutes: 240 } }],
    }));
    refused(second, 'billing:create');
    expect(await rowCounts()).toEqual(before);
  });

  it('6. a refused overlay leaves no half-written pool', async () => {
    const result = await saveContractLineEdit(lineId, await draft({
      bucket_overlays: [{ service_id: unattachedServiceId, overlay: OVERLAY }],
    }));
    refused(result, 'billing:create');
    const after = await rowCounts();
    expect(after.buckets).toBe(0);
    expect(after.bucketServices).toBe(0);
    expect(after.unattachedMemberships).toBe(0);
  });
});
