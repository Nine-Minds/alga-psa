/**
 * Client picker perf E: the targeted read shapes that replace "fetch every client" on the
 * contacts, billing, projects and assets screens. Each query is tenant scoped, so every case
 * also seeds a second tenant that must never leak in.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const context = vi.hoisted(() => ({
  tenant: '',
  userId: '',
  db: null as any,
  allowed: true,
  logoCalls: [] as string[][],
}));

vi.mock('@alga-psa/auth', () => {
  const authed = (fn: any) => (...args: any[]) =>
    fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args);
  return {
  withAuth: authed,
  withOptionalAuth: authed,
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => context.allowed),
  preCheckDeletion: vi.fn(),
  localizeActionError: async (error: any) => error,
  AuthenticationError: class AuthenticationError extends Error {},
  };
});
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => context.allowed),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => {
  const logos = async (ids: string[]) => {
    context.logoCalls.push(ids);
    return new Map(ids.map((id) => [id, `/logo/${id}`]));
  };
  return {
    getClientLogoUrlsBatch: logos,
    getContactAvatarUrlsBatch: async () => new Map(),
    getClientLogoUrl: async (id: string) => `/logo/${id}`,
    getEntityImageUrl: async () => null,
  };
});

import { findClientsByNames } from '@alga-psa/clients/actions/clientActions';
import { getAllContacts, getContactsByClient } from '@alga-psa/clients/actions/queryActions';
import {
  getClientByIdForBillingRecoverable,
  getContractAssignmentsForReport,
  countActiveClientsByContract,
} from '@alga-psa/billing/actions/billingClientsActions';
import { getUsageRecords } from '@alga-psa/billing/actions/usageActions';

let db: Knex;
const databaseName = `client_picker_perf_e_${randomUUID().replaceAll('-', '')}`;
const otherTenant = randomUUID();
const ids: Record<string, string> = {};

async function seedTenant(tenant: string) {
  await db('tenants').insert({ tenant, client_name: `T ${tenant}`, email: `${tenant}@example.test`, product_code: 'psa' });
}
async function seedClient(tenant: string, name: string, extra: Record<string, unknown> = {}) {
  const client_id = randomUUID();
  await db('clients').insert({ tenant, client_id, client_name: name, client_type: 'company', is_inactive: false, ...extra });
  return client_id;
}
async function seedContract(tenant: string, name: string) {
  const contract_id = randomUUID();
  await db('contracts').insert({ tenant, contract_id, contract_name: name, billing_frequency: 'monthly', status: 'active', is_active: true });
  return contract_id;
}
async function assign(tenant: string, clientId: string, contractId: string, extra: Record<string, unknown> = {}) {
  await db('client_contracts').insert({
    tenant, client_contract_id: randomUUID(), client_id: clientId, contract_id: contractId,
    start_date: '2026-01-01', is_active: true, ...extra,
  });
}

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
  context.db = db;
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await seedTenant(context.tenant);
  await seedTenant(otherTenant);

  ids.acme = await seedClient(context.tenant, 'Acme Widgets');
  ids.bravo = await seedClient(context.tenant, 'Bravo Logistics');
  ids.dormant = await seedClient(context.tenant, 'Dormant Co', { is_inactive: true });
  ids.foreign = await seedClient(otherTenant, 'Acme Widgets'); // same name, other tenant

  // contacts
  for (const [key, clientId, name] of [
    ['c1', ids.acme, 'Alice A'],
    ['c2', ids.acme, 'Bob B'],
    ['c3', ids.bravo, 'Cara C'],
    ['c4', null, 'No Client'],
  ] as const) {
    ids[key] = randomUUID();
    await db('contacts').insert({
      tenant: context.tenant, contact_name_id: ids[key], full_name: name, email: `${key}@example.test`,
      client_id: clientId, is_inactive: false,
    });
  }

  // contracts + assignments
  ids.contractA = await seedContract(context.tenant, 'Gold Support');
  ids.contractB = await seedContract(context.tenant, 'Silver Support');
  ids.contractEmpty = await seedContract(context.tenant, 'Unused');
  ids.foreignContract = await seedContract(otherTenant, 'Foreign Contract');
  await db('contract_lines').insert([
    { tenant: context.tenant, contract_line_id: randomUUID(), contract_id: ids.contractA, contract_line_name: 'L1' },
    { tenant: context.tenant, contract_line_id: randomUUID(), contract_id: ids.contractA, contract_line_name: 'L2' },
  ]);
  await assign(context.tenant, ids.acme, ids.contractA);
  await assign(context.tenant, ids.bravo, ids.contractA);
  await assign(context.tenant, ids.dormant, ids.contractA); // inactive client: excluded
  await assign(context.tenant, ids.acme, ids.contractB, { is_active: false }); // inactive assignment
  await assign(context.tenant, ids.bravo, ids.contractB);
  await assign(otherTenant, ids.foreign, ids.foreignContract);

  // usage
  const serviceTypeId = randomUUID();
  await db('service_types').insert({ id: serviceTypeId, tenant: context.tenant, name: 'T', is_active: true, order_number: 1 });
  ids.service = randomUUID();
  await db('service_catalog').insert({
    tenant: context.tenant, service_id: ids.service, service_name: 'Bandwidth', billing_method: 'usage',
    custom_service_type_id: serviceTypeId, default_rate: 100, unit_of_measure: 'gb',
  });
  for (const clientId of [ids.acme, ids.acme, ids.bravo]) {
    await db('usage_tracking').insert({
      tenant: context.tenant, usage_id: randomUUID(), client_id: clientId, service_id: ids.service,
      usage_date: new Date('2026-02-01T00:00:00Z'), quantity: 1,
    });
  }
}, 180_000);

afterAll(async () => {
  await db?.destroy();
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
  finally { await admin.destroy(); }
});

describe('findClientsByNames', () => {
  it('matches exact, case-sensitive names and returns only id and name', async () => {
    const rows = await findClientsByNames(['Acme Widgets', 'acme widgets', 'Dormant Co', 'Nope']);
    expect(rows.map((r) => r.client_name).sort()).toEqual(['Acme Widgets', 'Dormant Co']);
    expect(Object.keys(rows[0]).sort()).toEqual(['client_id', 'client_name']);
  });

  it('is tenant scoped: a same-named client in another tenant never resolves', async () => {
    const rows = await findClientsByNames(['Acme Widgets']);
    expect(rows).toEqual([{ client_id: ids.acme, client_name: 'Acme Widgets' }]);
    expect(rows.map((r) => r.client_id)).not.toContain(ids.foreign);
  });

  it('returns [] for no names and rejects callers without client:read', async () => {
    expect(await findClientsByNames([])).toEqual([]);
    context.allowed = false;
    try {
      await expect(findClientsByNames(['Acme Widgets'])).rejects.toThrow(/Permission denied/);
    } finally {
      context.allowed = true;
    }
  });
});

describe('getClientByIdForBillingRecoverable', () => {
  it('loads one client, including an inactive one, with its logo', async () => {
    const acme: any = await getClientByIdForBillingRecoverable(ids.acme);
    expect(acme.client_name).toBe('Acme Widgets');
    expect(acme.logoUrl).toBe(`/logo/${ids.acme}`);
    const dormant: any = await getClientByIdForBillingRecoverable(ids.dormant);
    expect(dormant.client_name).toBe('Dormant Co');
  });

  it('returns null for another tenant’s client or an unknown id', async () => {
    expect(await getClientByIdForBillingRecoverable(ids.foreign)).toBeNull();
    expect(await getClientByIdForBillingRecoverable(randomUUID())).toBeNull();
  });
});

describe('getContractAssignmentsForReport', () => {
  it('returns one row per active client with name, logo and the contract line count', async () => {
    context.logoCalls.length = 0;
    const rows: any[] = await getContractAssignmentsForReport(ids.contractA);
    expect(rows.map((r) => r.client_name)).toEqual(['Acme Widgets', 'Bravo Logistics']);
    expect(rows.every((r) => r.contract_line_count === 2)).toBe(true);
    expect(rows[0].client_logo_url).toBe(`/logo/${ids.acme}`);
    expect(rows[0].contract_name).toBe('Gold Support');
    expect(context.logoCalls).toHaveLength(1);
  });

  it('skips inactive assignments and is tenant scoped', async () => {
    const b: any[] = await getContractAssignmentsForReport(ids.contractB);
    expect(b.map((r) => r.client_id)).toEqual([ids.bravo]);
    expect(await getContractAssignmentsForReport(ids.foreignContract)).toEqual([]);
  });
});

describe('countActiveClientsByContract', () => {
  it('counts distinct active clients per contract in one grouped query', async () => {
    const rows = await countActiveClientsByContract([ids.contractA, ids.contractB, ids.contractEmpty]);
    expect(rows).toEqual([
      { contract_id: ids.contractA, active_client_count: 2 },
      { contract_id: ids.contractB, active_client_count: 1 },
      { contract_id: ids.contractEmpty, active_client_count: 0 },
    ]);
  });

  it('does not count another tenant’s assignments', async () => {
    expect(await countActiveClientsByContract([ids.foreignContract])).toEqual([
      { contract_id: ids.foreignContract, active_client_count: 0 },
    ]);
    expect(await countActiveClientsByContract([])).toEqual([]);
  });
});

describe('client_logo_url on list actions', () => {
  it('getAllContacts attaches logos for distinct clients only', async () => {
    context.logoCalls.length = 0;
    const contacts: any[] = await getAllContacts('all');
    const byName = Object.fromEntries(contacts.map((c) => [c.full_name, c]));
    expect(byName['Alice A'].client_logo_url).toBe(`/logo/${ids.acme}`);
    expect(byName['Cara C'].client_logo_url).toBe(`/logo/${ids.bravo}`);
    expect(byName['No Client'].client_logo_url).toBeNull();
    expect(byName['Alice A'].client_name).toBe('Acme Widgets');
    expect(context.logoCalls).toHaveLength(1);
    expect(context.logoCalls[0].sort()).toEqual([ids.acme, ids.bravo].sort());
  });

  it('getContactsByClient attaches the single client logo', async () => {
    const contacts: any[] = await getContactsByClient(ids.acme, 'all');
    expect(contacts).toHaveLength(2);
    expect(contacts.every((c) => c.client_logo_url === `/logo/${ids.acme}`)).toBe(true);
  });

  it('getUsageRecords attaches logos from one batched lookup', async () => {
    context.logoCalls.length = 0;
    const records: any[] = await getUsageRecords();
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.client_logo_url === `/logo/${r.client_id}`)).toBe(true);
    expect(context.logoCalls).toHaveLength(1);
    expect(context.logoCalls[0].sort()).toEqual([ids.acme, ids.bravo].sort());
  });
});
