/**
 * Authorization of "add service to contract line" against the rows it writes
 * (card f1526cf7, plan docs/plans/2026-10-29-add-service-membership-authz.md).
 *
 * Adding a service that is already on a line is an upsert: it rewrites the
 * stored configuration with caller-controlled values. The permission therefore
 * follows the rows the call creates or changes: `billing:create` when the
 * membership or configuration is missing, `billing:update` when both exist.
 * Real DB (see the integration-testing skill); the auth mocks mirror
 * contractTemplateLineServiceTypes.integration.test.ts, except that
 * `hasPermission` honours a per-user permission set (via setupCommonMocks).
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let otherTenantId: string;
let serviceTypeId: string;
let addServiceToContractLine: typeof import('@alga-psa/billing/actions/contractLineServiceActions').addServiceToContractLine;
let authorizeMembershipWrite: typeof import('@alga-psa/billing/lib/billing/contractLineMembership').authorizeMembershipWrite;
let addServiceToContractLineInTransaction: typeof import('@alga-psa/billing/lib/billing/contractLineMembership').addServiceToContractLineInTransaction;

const t = (table: string) => tenantDb(db, tenantId).table(table);

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

type TestUser = { user_id: string; tenant: string; user_type: string; roles: unknown[]; perms: Set<string> };
const authRef: { user: TestUser | null; tenant: string } = { user: null, tenant: '' };

const asUser = (perms: string[]): TestUser => ({
  user_id: authRef.user?.user_id ?? uuidv4(),
  tenant: tenantId,
  user_type: 'internal',
  roles: [],
  perms: new Set(perms),
});

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => authRef.user),
  getSession: vi.fn(async () =>
    authRef.user ? { user: { id: authRef.user.user_id, tenant: authRef.tenant } } : null
  ),
  hasPermission: vi.fn(async () => true),
  withAuth: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, { tenant: authRef.tenant }, ...args);
  },
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user ?? null, authRef.user ? { tenant: authRef.tenant } : null, ...args),
  withAuthCheck: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, ...args);
  },
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(authRef.tenant, () => action(authRef.user, { tenant: authRef.tenant }, ...args));
  },
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user ?? null, authRef.user ? { tenant: authRef.tenant } : null, ...args),
  withAuthCheck: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, ...args);
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    // A real transaction, so a rejected add rolls back like production.
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      (knexOrTrx as Knex).transaction((trx) => callback(trx)),
    ),
  };
});

const CREATE_ONLY = ['billing:read', 'billing:create'];
const UPDATE_ONLY = ['billing:read', 'billing:update'];
const BOTH = ['billing:read', 'billing:create', 'billing:update'];

const permissionDenied = (value: unknown): string | undefined =>
  typeof value === 'object' && value !== null
    ? (value as { permissionError?: string }).permissionError
    : undefined;

async function insertService(name: string): Promise<{ serviceId: string; serviceName: string }> {
  const serviceId = uuidv4();
  const serviceName = `${name} ${serviceId.slice(0, 6)}`;
  await t('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: serviceName,
    description: name,
    default_rate: 5000,
    unit_of_measure: 'each',
    billing_method: 'fixed',
    item_kind: 'service',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  });
  await t('service_prices').insert({ tenant: tenantId, service_id: serviceId, currency_code: 'USD', rate: 5000 });
  return { serviceId, serviceName };
}

async function insertLiveLine(): Promise<string> {
  const contractId = uuidv4();
  await t('contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: `Authz Contract ${contractId.slice(0, 6)}`,
    billing_frequency: 'monthly',
    is_template: false,
    status: 'draft',
    currency_code: 'USD',
  });
  const lineId = uuidv4();
  await t('contract_lines').insert({
    tenant: tenantId,
    contract_line_id: lineId,
    contract_id: contractId,
    contract_line_name: `Authz Line ${lineId.slice(0, 6)}`,
    contract_line_type: 'Fixed',
    billing_frequency: 'monthly',
    display_order: 1,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return lineId;
}

async function insertTemplateLine(): Promise<string> {
  const templateId = uuidv4();
  await t('contract_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `Authz Template ${templateId.slice(0, 6)}`,
    default_billing_frequency: 'monthly',
    template_status: 'published',
    currency_code: 'USD',
  });
  const lineId = uuidv4();
  await t('contract_template_lines').insert({
    tenant: tenantId,
    template_line_id: lineId,
    template_id: templateId,
    template_line_name: `Authz Template Line ${lineId.slice(0, 6)}`,
    billing_frequency: 'monthly',
    line_type: 'Fixed',
  });
  return lineId;
}

const liveConfig = (lineId: string, serviceId: string) =>
  t('contract_line_service_configuration').where({ contract_line_id: lineId, service_id: serviceId }).first();
const liveMembership = (lineId: string, serviceId: string) =>
  t('contract_line_services').where({ contract_line_id: lineId, service_id: serviceId }).first();
const templateConfig = (lineId: string, serviceId: string) =>
  t('contract_template_line_service_configuration').where({ template_line_id: lineId, service_id: serviceId }).first();

async function asFullUser<T>(fn: () => Promise<T>): Promise<T> {
  const previous = authRef.user;
  authRef.user = asUser(BOTH);
  try {
    return await fn();
  } finally {
    authRef.user = previous;
  }
}

describe('addServiceToContractLine authorizes against the rows it writes', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.E2E_AUTH_BYPASS = 'true';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db, 'Membership Authz Tenant');
    otherTenantId = await ensureTenant(db, 'Membership Authz Other Tenant');
    const { createUser } = await import('../../../../test-utils/testDataFactory');
    const userId = await createUser(db, tenantId, { username: `membership-authz-${uuidv4().slice(0, 6)}` });
    authRef.user = asUser(BOTH);
    authRef.user.user_id = userId;
    authRef.tenant = tenantId;
    // The point of this suite: permissions come from the calling user, not a blanket true.
    // (setupCommonMocks owns the '@alga-psa/auth/rbac' mock; a local one would be overridden.)
    setupCommonMocks({
      tenantId,
      userId,
      permissionCheck: (user, resource, action) =>
        (user as unknown as TestUser).perms?.has(`${resource}:${action}`) ?? false,
    });

    serviceTypeId = uuidv4();
    await t('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `Membership Authz Type ${serviceTypeId.slice(0, 6)}`,
      order_number: Math.floor(Math.random() * 1_000_000),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    ({ addServiceToContractLine } = await import('@alga-psa/billing/actions/contractLineServiceActions'));
    ({ authorizeMembershipWrite, addServiceToContractLineInTransaction } = await import(
      '@alga-psa/billing/lib/billing/contractLineMembership'
    ));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('1. refuses a create-only user on an already-attached, configured service and leaves the configuration unchanged', async () => {
    const lineId = await insertLiveLine();
    const { serviceId, serviceName } = await insertService('Managed Backup');
    const seeded = await asFullUser(() => addServiceToContractLine(lineId, serviceId, 2, 1000));
    expect(typeof seeded, JSON.stringify(seeded)).toBe('string');
    const before = await liveConfig(lineId, serviceId);
    expect(Number(before.quantity)).toBe(2);

    authRef.user = asUser(CREATE_ONLY);
    const result = await addServiceToContractLine(lineId, serviceId, 99, 1);

    const denied = permissionDenied(result);
    expect(denied, JSON.stringify(result)).toMatch(/^Permission denied:/);
    expect(denied).toContain('billing:update');
    expect(denied).toContain(serviceName);
    const after = await liveConfig(lineId, serviceId);
    expect(after).toEqual(before);
    expect(Number(after.quantity)).toBe(2);
  }, 60_000);

  it('2. lets a create-only user attach a service that is not on the line yet', async () => {
    const lineId = await insertLiveLine();
    const { serviceId } = await insertService('New Attach');

    authRef.user = asUser(CREATE_ONLY);
    const result = await addServiceToContractLine(lineId, serviceId, 3);

    expect(typeof result, JSON.stringify(result)).toBe('string');
    expect(await liveMembership(lineId, serviceId)).toBeTruthy();
    expect(Number((await liveConfig(lineId, serviceId)).quantity)).toBe(3);
  }, 60_000);

  it('3. refuses an update-only user when the call would create the missing configuration', async () => {
    const lineId = await insertLiveLine();
    const { serviceId } = await insertService('Member Without Config');
    await t('contract_line_services').insert({ tenant: tenantId, contract_line_id: lineId, service_id: serviceId });

    authRef.user = asUser(UPDATE_ONLY);
    const result = await addServiceToContractLine(lineId, serviceId, 5);

    expect(permissionDenied(result), JSON.stringify(result)).toContain('billing:create');
    expect(await liveConfig(lineId, serviceId)).toBeUndefined();
  }, 60_000);

  it('4. lets an update-only user reprice an attached, configured service', async () => {
    const lineId = await insertLiveLine();
    const { serviceId } = await insertService('Reprice Me');
    await asFullUser(() => addServiceToContractLine(lineId, serviceId, 2, 1000));

    authRef.user = asUser(UPDATE_ONLY);
    const result = await addServiceToContractLine(lineId, serviceId, 7, 2500);

    expect(typeof result, JSON.stringify(result)).toBe('string');
    const config = await liveConfig(lineId, serviceId);
    expect(Number(config.quantity)).toBe(7);
    expect(Number(config.custom_rate)).toBe(2500);
  }, 60_000);

  it('5. authorizeMembershipWrite names the service and permission, and never sees another tenant\'s line', async () => {
    const lineId = await insertLiveLine();
    const { serviceId, serviceName } = await insertService('Helper Subject');

    const noPerms = asUser(['billing:read']);
    await expect(
      db.transaction((trx) => authorizeMembershipWrite(trx, tenantId, noPerms as any, lineId, serviceId)),
    ).rejects.toThrow(new RegExp(`^Permission denied: billing:create required.*"${serviceName}"`));

    const createUser = asUser(CREATE_ONLY);
    await expect(
      db.transaction((trx) => authorizeMembershipWrite(trx, tenantId, createUser as any, lineId, serviceId)),
    ).resolves.toEqual({ membershipExists: false, configurationExists: false });

    // The same line id under another tenant is invisible: not found, not a classification.
    await expect(
      db.transaction((trx) => authorizeMembershipWrite(trx, otherTenantId, createUser as any, lineId, serviceId)),
    ).rejects.toThrow(/not found/);
  }, 60_000);

  it('6. serializes concurrent adds on the line lock: the second sees the first\'s membership and never double-inserts', async () => {
    const lineId = await insertLiveLine();
    const { serviceId } = await insertService('Concurrent Add');
    const user = asUser(BOTH) as any;

    const first = await db.transaction();
    await addServiceToContractLineInTransaction(first, tenantId, user, lineId, serviceId, 1);

    let secondSettled = false;
    const second = db
      .transaction((trx) => authorizeMembershipWrite(trx, tenantId, user, lineId, serviceId))
      .finally(() => { secondSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(secondSettled, 'second transaction must wait on the line lock').toBe(false);

    await first.commit();
    await expect(second).resolves.toEqual({ membershipExists: true, configurationExists: true });

    const rows = await t('contract_line_services').where({ contract_line_id: lineId, service_id: serviceId });
    expect(rows).toHaveLength(1);
    const configs = await t('contract_line_service_configuration').where({ contract_line_id: lineId, service_id: serviceId });
    expect(configs).toHaveLength(1);
  }, 60_000);

  it('7. template line: a create-only user cannot rewrite an existing template configuration', async () => {
    const lineId = await insertTemplateLine();
    const { serviceId, serviceName } = await insertService('Template Member');
    const seeded = await asFullUser(() => addServiceToContractLine(lineId, serviceId, 2, 1000));
    expect(typeof seeded, JSON.stringify(seeded)).toBe('string');
    const before = await templateConfig(lineId, serviceId);
    const membershipBefore = await t('contract_template_line_services')
      .where({ template_line_id: lineId, service_id: serviceId }).first();
    expect(Number(before.quantity)).toBe(2);

    authRef.user = asUser(CREATE_ONLY);
    const result = await addServiceToContractLine(lineId, serviceId, 50, 1);

    const denied = permissionDenied(result);
    expect(denied, JSON.stringify(result)).toMatch(/^Permission denied:/);
    expect(denied).toContain('billing:update');
    expect(denied).toContain(serviceName);
    expect(await templateConfig(lineId, serviceId)).toEqual(before);
    expect(await t('contract_template_line_services')
      .where({ template_line_id: lineId, service_id: serviceId }).first()).toEqual(membershipBefore);
  }, 60_000);

  it('8. template line: create-only may attach a new service, update-only may reprice it, and neither crosses over', async () => {
    const lineId = await insertTemplateLine();
    const { serviceId } = await insertService('Template Flow');

    authRef.user = asUser(UPDATE_ONLY);
    expect(permissionDenied(await addServiceToContractLine(lineId, serviceId, 1))).toContain('billing:create');
    expect(await templateConfig(lineId, serviceId)).toBeUndefined();

    authRef.user = asUser(CREATE_ONLY);
    expect(typeof await addServiceToContractLine(lineId, serviceId, 1)).toBe('string');

    authRef.user = asUser(UPDATE_ONLY);
    expect(typeof await addServiceToContractLine(lineId, serviceId, 4, 900)).toBe('string');
    const config = await templateConfig(lineId, serviceId);
    expect(Number(config.quantity)).toBe(4);
    expect(Number(config.custom_rate)).toBe(900);
  }, 60_000);
});

async function ensureTenant(connection: Knex, name: string): Promise<string> {
  const existing = await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture reads tenant rows')
    .where({ client_name: name })
    .first<{ tenant: string }>('tenant');
  if (existing?.tenant) return existing.tenant;
  const newTenantId = uuidv4();
  await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates tenant rows')
    .insert({
      tenant: newTenantId,
      client_name: name,
      email: `${newTenantId.slice(0, 8)}@membership-authz.test.co`,
      created_at: connection.fn.now(),
      updated_at: connection.fn.now(),
    });
  return newTenantId;
}
