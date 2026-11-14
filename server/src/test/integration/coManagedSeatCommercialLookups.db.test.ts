/**
 * Co-managed seat, slice S13 (F031, F032 / T018) on real Postgres.
 *
 * The service-catalog and eligible-contract-line lookups refuse anyone who is not an internal user
 * holding a commercial read permission, and a client record read by a subject without billing
 * permission leaves out the billing columns. A seat technician holds only the seat role
 * (`CO_MANAGED_SEAT_ROLE_GRANTS`), which names no billing or service permission. A client-portal
 * Admin holds `billing:read` in the portal scope, so it proves the guard checks the user type too.
 *
 * Authentication is the only substitution: `withAuth` hands the action the acting user's real row.
 * Permission checks, role rows and the actions themselves are the product's own.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { admitCoManagedSeatRole, CO_MANAGED_SEAT_ROLE_GRANTS } from '@alga-psa/co-managed';
import { CLIENT_BILLING_COLUMNS } from '@alga-psa/auth/lib/clientBillingProjection';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const actor = vi.hoisted(() => ({ user: null as any }));
const dbRef = vi.hoisted(() => ({ db: null as any }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));
vi.mock('@alga-psa/db', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...real, getConnection: async () => dbRef.db, getAdminConnection: async () => dbRef.db,
    createTenantKnex: async (tenant?: string) => ({ knex: dbRef.db, tenant: tenant ?? actor.user?.tenant }) };
});
vi.mock('@alga-psa/auth', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/auth')>();
  const { runWithTenant } = await import('@alga-psa/db');
  return { ...real, withAuth: (handler: any) => (...args: any[]) =>
    runWithTenant(actor.user.tenant, () => handler(actor.user, { tenant: actor.user.tenant }, ...args)),
  getSession: async () => ({ user: { id: actor.user.user_id, tenant: actor.user.tenant, user_type: actor.user.user_type } }),
  getApiKeyUserOverride: () => null };
});
vi.mock('@alga-psa/user-composition/actions', async importOriginal => {
  const real = await importOriginal<any>();
  return { ...real, getCurrentUser: async () => actor.user };
});

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const describeDb = await describeWithDb();

describeDb('seat technicians and portal users: commercial lookups and client billing columns', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let serviceId: string;
  const people = {} as Record<'seat' | 'portal' | 'admin' | 'technician', any>;

  const userRow = (id: string) => db('users').where({ tenant, user_id: id }).first();
  const grantRole = async (userId: string, roleId: string) => db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
  const roleId = async (roleName: string, msp: boolean) =>
    (await db('roles').where({ tenant, role_name: roleName, msp, client: !msp }).first('role_id')).role_id as string;
  const as = (person: keyof typeof people) => { actor.user = people[person]; };

  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.db = db;
    tenant = await createTenant(db, `S13 ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, tenant, 'psa');

    clientId = await createClient(db, tenant, 'S13 client', { payment_terms: 'net_45', credit_limit: 5000, billing_cycle: 'weekly' as any });
    await db('clients').where({ tenant, client_id: clientId }).update({
      billing_email: 'ap@s13.example', preferred_payment_method: 'check', auto_invoice: true, invoice_delivery_method: 'email',
    });

    const seatRoleId = await db.transaction(trx => admitCoManagedSeatRole(trx, tenant));
    const seat = await createUser(db, tenant, { user_type: 'internal', username: 's13.seat' });
    await grantRole(seat, seatRoleId);
    const admin = await createUser(db, tenant, { user_type: 'internal', username: 's13.admin' });
    await grantRole(admin, await roleId('Admin', true));
    const technician = await createUser(db, tenant, { user_type: 'internal', username: 's13.tech' });
    await grantRole(technician, await roleId('Technician', true));
    const portal = await createUser(db, tenant, { user_type: 'client', username: 's13.portal' });
    await grantRole(portal, await roleId('Admin', false));
    people.seat = await userRow(seat); people.admin = await userRow(admin);
    people.technician = await userRow(technician); people.portal = await userRow(portal);

    // A service, and a contract line that covers it for the client.
    const typeId = randomUUID(), contractId = randomUUID(), lineId = randomUUID();
    serviceId = randomUUID();
    await db('service_types').insert({ id: typeId, tenant, name: `S13 type ${typeId.slice(0, 6)}`, is_active: true, order_number: 1 });
    await db('service_catalog').insert({ tenant, service_id: serviceId, service_name: 'S13 consulting', default_rate: 12000, billing_method: 'hourly',
      custom_service_type_id: typeId, unit_of_measure: 'hour', item_kind: 'service', is_active: true });
    await db('service_prices').insert({ tenant, price_id: randomUUID(), service_id: serviceId, currency_code: 'USD', rate: 12000 });
    await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'S13 contract', billing_frequency: 'monthly',
      is_active: true, status: 'active', currency_code: 'USD', owner_client_id: clientId });
    await db('client_contracts').insert({ tenant, client_contract_id: randomUUID(), client_id: clientId, contract_id: contractId, start_date: '2026-01-01', is_active: true });
    await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'S13 hourly',
      contract_line_type: 'Hourly', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true });
    await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId, quantity: 1, custom_rate: 12000 });
  }, 180_000);

  afterAll(async () => { await db?.destroy().catch(() => undefined); });

  it('the seat role names no billing or service permission, and the permitted internal roles hold one', async () => {
    expect(CO_MANAGED_SEAT_ROLE_GRANTS.filter(grant => /^(billing|service):/.test(grant))).toEqual([]);
    const { hasCommercialReadPermission } = await import('@alga-psa/auth/lib/commercialAccess');
    expect(await hasCommercialReadPermission(people.admin)).toBe(true);
    expect(await hasCommercialReadPermission(people.seat)).toBe(false);
    expect(await hasCommercialReadPermission(people.portal)).toBe(false);
  });

  /** Every gated entry point, each called as the acting person. Refusals are thrown errors or returned permission errors. */
  const entryPoints = () => ({
    'billing getServices': async () => (await import('../../../../packages/billing/src/actions/serviceActions')).getServices(1, 999, { item_kind: 'any' }),
    'integrations getServices': async () => (await import('../../../../packages/integrations/src/actions/serviceCatalogActions')).getServices(1, 999),
    'projects getServices': async () => (await import('../../../../packages/projects/src/actions/serviceCatalogActions')).getServices(1, 999),
    'scheduling getServices': async () => (await import('../../../../packages/scheduling/src/actions/serviceCatalogActions')).getServices(1, 999),
    'clients getServicesAsync': async () => (await import('../../../../packages/clients/src/lib/billingHelpers')).getServicesAsync(1, 999),
    'billing usage getEligibleContractLinesForUI': async () =>
      (await import('../../../../packages/billing/src/actions/usageActions')).getEligibleContractLinesForUI(clientId, serviceId, '2026-06-01'),
    'billing lib getEligibleContractLinesForUI': async () =>
      (await import('../../../../packages/billing/src/lib/contractLineDisambiguation')).getEligibleContractLinesForUI(actor.user, db, tenant, clientId, serviceId, '2026-06-01'),
    'scheduling lib getEligibleContractLinesForUI': async () =>
      (await import('../../../../packages/scheduling/src/lib/contractLineDisambiguation')).getEligibleContractLinesForUI(clientId, serviceId, '2026-06-01'),
    'server lib getEligibleContractLinesForUI': async () =>
      (await import('../../lib/utils/contractLineDisambiguation')).getEligibleContractLinesForUI(clientId, serviceId),
  } as Record<string, () => Promise<any>>);

  const outcome = async (call: () => Promise<any>) => {
    try { return { value: await call() }; } catch (error) { return { error: error as Error }; }
  };
  const refused = (result: { value?: any; error?: Error }) =>
    Boolean(result.error && /Permission denied/.test(result.error.message)) || Boolean(result.value && typeof result.value === 'object' && 'permissionError' in result.value);

  for (const person of ['seat', 'portal'] as const) {
    it(`${person}: every gated lookup is refused`, async () => {
      as(person);
      for (const [name, call] of Object.entries(entryPoints())) {
        const result = await outcome(call);
        expect(refused(result), `${name} as ${person}: ${JSON.stringify(result.value) ?? result.error?.message}`).toBe(true);
      }
    });
  }

  it('an internal user holding the permission gets the same data as before', async () => {
    as('admin');
    const points = entryPoints();
    for (const name of ['integrations getServices', 'projects getServices', 'scheduling getServices', 'clients getServicesAsync']) {
      const result = await points[name]();
      expect(result.services.map((s: any) => s.service_id), name).toEqual([serviceId]);
      expect(Number(result.services[0].default_rate), name).toBe(12000);
    }
    const billing = await points['billing getServices']();
    expect(billing.services.map((s: any) => s.service_id)).toEqual([serviceId]);
    expect(Number(billing.services[0].default_rate)).toBe(12000);
    for (const name of ['billing usage getEligibleContractLinesForUI', 'billing lib getEligibleContractLinesForUI',
      'scheduling lib getEligibleContractLinesForUI']) {
      const lines = await points[name]();
      expect(Array.isArray(lines), `${name}: ${JSON.stringify(lines)}`).toBe(true);
      expect(lines.map((l: any) => l.contract_line_name), name).toEqual(['S13 hourly']);
    }
  });

  it('the unused server/src copy of the lookup passes an internal user through to its own (unchanged) body', async () => {
    as('admin');
    // That copy opens its own connection through server/src/lib/db, which this suite does not substitute, and it
    // answers an empty list when that fails; what matters here is that the guard let the user through.
    const lines = await entryPoints()['server lib getEligibleContractLinesForUI']();
    expect(Array.isArray(lines)).toBe(true);
  });

  it('a standard Technician (neither service nor billing read) is refused: the release risk this slice records', async () => {
    as('technician');
    const result = await outcome(entryPoints()['scheduling lib getEligibleContractLinesForUI']);
    expect(refused(result)).toBe(true);
  });

  const BILLING_COLUMNS: readonly string[] = CLIENT_BILLING_COLUMNS;
  const leaked = (row: Record<string, unknown>) => BILLING_COLUMNS.filter(column => column in row);

  it('a client read by the seat technician carries no billing column; the billing-permitted user still gets them', async () => {
    const { getClientById, getAllClients } = await import('../../../../packages/clients/src/actions/queryActions');
    const { getAllClientsPaginated } = await import('../../../../packages/clients/src/actions/clientActions');

    as('seat');
    const seatOne: any = await getClientById(clientId);
    expect(seatOne?.client_name).toBe('S13 client');
    expect(leaked(seatOne)).toEqual([]);
    const seatAll: any[] = await getAllClients();
    expect(seatAll.map(c => c.client_id)).toContain(clientId);
    for (const row of seatAll) expect(leaked(row)).toEqual([]);
    const seatPage: any = await getAllClientsPaginated({ pageSize: 50 });
    expect(seatPage.clients.map((c: any) => c.client_id)).toContain(clientId);
    for (const row of seatPage.clients) expect(leaked(row)).toEqual([]);

    as('admin');
    const adminOne: any = await getClientById(clientId);
    expect(adminOne).toMatchObject({ payment_terms: 'net_45', billing_cycle: 'weekly', billing_email: 'ap@s13.example',
      preferred_payment_method: 'check', auto_invoice: true, invoice_delivery_method: 'email' });
    expect(Number(adminOne.credit_limit)).toBe(5000);
    const adminAll: any[] = await getAllClients();
    expect(adminAll.find(c => c.client_id === clientId)).toMatchObject({ payment_terms: 'net_45', billing_cycle: 'weekly' });
    const adminPage: any = await getAllClientsPaginated({ pageSize: 50 });
    expect(adminPage.clients.find((c: any) => c.client_id === clientId)).toMatchObject({ payment_terms: 'net_45', billing_cycle: 'weekly' });
  });
});
