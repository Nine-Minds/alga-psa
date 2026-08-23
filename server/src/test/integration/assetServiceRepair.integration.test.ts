import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};
const actionAuth = vi.hoisted(() => ({ tenant: '', userId: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    hasPermission: vi.fn().mockResolvedValue(true),
    withAuth: (action: any) => async (...args: unknown[]) => action(
      { user_id: actionAuth.userId },
      { tenant: actionAuth.tenant },
      ...args,
    ),
  };
});
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: db, tenant: actionAuth.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

let db: Knex;
let AssetService: typeof import('../../lib/api/services/AssetService').AssetService;
let InventoryService: typeof import('../../lib/api/services/InventoryService').InventoryService;
let createOccurrenceTicket: typeof import('@alga-psa/assets/actions/assetActions').createOccurrenceTicket;
const cleanupTenants = new Set<string>();

function hasColumn(table: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[table] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_repair_fixture__').unscoped(name, 'asset repair integration fixture');
}

type Fixture = {
  tenantId: string;
  userId: string;
  clientId: string;
  assetId: string;
  relatedAssetId: string;
  scheduleId: string;
  occurrenceId: string;
};

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Asset Repair PSA' } : { client_name: 'Asset Repair PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `asset-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Asset',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `asset-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Emerald City',
    ...(hasColumn('clients', 'billing_email') ? { billing_email: 'ops@emerald.example' } : {}),
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const assetId = randomUUID();
  const relatedAssetId = randomUUID();
  const baseAsset = (id: string, tag: string, name: string) => ({
    tenant: tenantId,
    asset_id: id,
    asset_tag: tag,
    serial_number: tag,
    name,
    status: 'active',
    asset_type: 'workstation',
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table(tenantId, 'assets').insert([
    baseAsset(assetId, 'ASSET-PRIMARY', 'Front desk workstation'),
    baseAsset(relatedAssetId, 'ASSET-DOCK', 'Docking station'),
  ]);

  await table(tenantId, 'asset_relationships').insert({
    tenant: tenantId,
    parent_asset_id: assetId,
    child_asset_id: relatedAssetId,
    relationship_type: 'connected_to',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const scheduleId = randomUUID();
  await table(tenantId, 'asset_maintenance_schedules').insert({
    tenant: tenantId,
    schedule_id: scheduleId,
    asset_id: assetId,
    schedule_name: 'Quarterly deep clean',
    description: 'Fans, vents, thermal check',
    maintenance_type: 'preventive',
    frequency: 'quarterly',
    frequency_interval: 1,
    schedule_config: JSON.stringify({}),
    next_maintenance: db.raw("NOW() + INTERVAL '5 days'"),
    is_active: true,
    created_by: userId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const occurrenceId = randomUUID();
  await table(tenantId, 'asset_maintenance_occurrences').insert({
    tenant: tenantId,
    occurrence_id: occurrenceId,
    schedule_id: scheduleId,
    asset_id: assetId,
    due_date: db.raw("NOW() + INTERVAL '5 days'"),
    status: 'open',
  });

  return { tenantId, userId, clientId, assetId, relatedAssetId, scheduleId, occurrenceId };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of [
    'asset_associations',
    'asset_maintenance_occurrences',
    'asset_maintenance_history',
    'asset_maintenance_schedules',
    'asset_relationships',
    'tickets',
    'assets',
    'clients',
    'users',
  ]) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

describe('AssetService REST repairs (integration)', () => {
  beforeAll(async () => {
    // Use the worktree's isolated test Postgres (and its secret-backed
    // credentials) rather than whatever local server .env happened to load.
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients']) {
      columns[name] = await tenantDb(db, '__asset_repair_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ AssetService } = await import('../../lib/api/services/AssetService'));
    ({ InventoryService } = await import('../../lib/api/services/InventoryService'));
    ({ createOccurrenceTicket } = await import('@alga-psa/assets/actions/assetActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('hydrates an asset with client, relationships and schedules without a schema-drift 500', async () => {
    const fx = await seedFixture();
    const ctx = { tenant: fx.tenantId, userId: fx.userId, db } as any;
    const service = new AssetService();

    const detail = await service.getWithDetails(fx.assetId, ctx);
    expect(detail).toBeTruthy();
    // getAssetClient must select existing columns (client_id/name/billing_email),
    // never the dropped clients.email/phone_no that used to 500 the whole asset.
    expect(detail.client).toMatchObject({ client_id: fx.clientId, client_name: 'Emerald City' });

    // getAssetRelationships resolves via parent/child columns and labels direction.
    expect(detail.relationships).toHaveLength(1);
    expect(detail.relationships[0]).toMatchObject({
      related_asset_id: fx.relatedAssetId,
      related_asset_name: 'Docking station',
    });

    // getMaintenanceSchedules joins created_by -> created_by_name (not the dropped assigned_to).
    expect(detail.maintenance_schedules).toHaveLength(1);
    expect(detail.maintenance_schedules[0].schedule_id).toBe(fx.scheduleId);
  }, HOOK_TIMEOUT);

  it('records maintenance into history, advances the schedule, and rejects a repeat for the same occurrence', async () => {
    const fx = await seedFixture();
    const ctx = { tenant: fx.tenantId, userId: fx.userId, db } as any;
    const service = new AssetService();

    const before = await table(fx.tenantId, 'asset_maintenance_schedules').where({ schedule_id: fx.scheduleId }).first();

    const recorded = await service.recordMaintenance(
      fx.assetId,
      { schedule_id: fx.scheduleId, occurrence_id: fx.occurrenceId, maintenance_type: 'preventive', description: 'Blew out dust' } as any,
      ctx,
    );
    expect(recorded.schedule_id).toBe(fx.scheduleId);

    const history = await table(fx.tenantId, 'asset_maintenance_history').where({ asset_id: fx.assetId });
    expect(history).toHaveLength(1);
    expect(history[0].description).toBe('Blew out dust');
    expect(history[0].performed_by).toBe(fx.userId);

    const after = await table(fx.tenantId, 'asset_maintenance_schedules').where({ schedule_id: fx.scheduleId }).first();
    expect(new Date(after.next_maintenance).getTime()).toBeGreaterThan(new Date(before.next_maintenance).getTime());
    expect(new Date(after.last_maintenance).getTime()).toBeGreaterThan(0);
    const completed = await table(fx.tenantId, 'asset_maintenance_occurrences').where({ schedule_id: fx.scheduleId, status: 'completed' });
    const next = await table(fx.tenantId, 'asset_maintenance_occurrences').where({ schedule_id: fx.scheduleId, status: 'open' });
    expect(completed).toHaveLength(1);
    expect(next).toHaveLength(1);
    await expect(service.recordMaintenance(fx.assetId, { schedule_id: fx.scheduleId, occurrence_id: fx.occurrenceId, maintenance_type: 'preventive' } as any, ctx)).rejects.toThrow('already been closed');
  }, HOOK_TIMEOUT);

  it('rejects a schedule used with another asset and leaves paused schedules inert', async () => {
    const fx = await seedFixture();
    const ctx = { tenant: fx.tenantId, userId: fx.userId, db } as any;
    const service = new AssetService();
    await expect(service.recordMaintenance(fx.relatedAssetId, { schedule_id: fx.scheduleId, maintenance_type: 'preventive' } as any, ctx)).rejects.toThrow();
    await table(fx.tenantId, 'asset_maintenance_schedules').where({ schedule_id: fx.scheduleId }).update({ is_active: false });
    await expect(service.recordMaintenance(fx.assetId, { schedule_id: fx.scheduleId, maintenance_type: 'preventive' } as any, ctx)).rejects.toThrow('inactive');
    expect(await table(fx.tenantId, 'asset_maintenance_history').where({ schedule_id: fx.scheduleId })).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('links a created ticket once when the occurrence action is retried', async () => {
    const fx = await seedFixture();
    const ticketId = randomUUID();
    await table(fx.tenantId, 'tickets').insert({
      tenant: fx.tenantId,
      ticket_id: ticketId,
      ticket_number: `MAINT-${ticketId.slice(0, 8)}`,
      client_id: fx.clientId,
      title: 'Maintenance smoke ticket',
    });
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;

    const first = await createOccurrenceTicket(fx.occurrenceId, ticketId);
    const second = await createOccurrenceTicket(fx.occurrenceId, ticketId);

    expect(first).toMatchObject({ occurrence_id: fx.occurrenceId, ticket_id: ticketId });
    expect(second).toMatchObject({ occurrence_id: fx.occurrenceId, ticket_id: ticketId });
    expect(await table(fx.tenantId, 'asset_associations').where({ asset_id: fx.assetId, entity_id: ticketId })).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('resolves a scanned serial to its asset via inventory lookup', async () => {
    const fx = await seedFixture();
    const ctx = { tenant: fx.tenantId, userId: fx.userId, db } as any;
    const result = await new InventoryService().lookup('ASSET-PRIMARY', ctx);
    expect(result.type).toBe('asset');
    if (result.type === 'asset') {
      expect(result.asset).toMatchObject({ asset_id: fx.assetId, name: 'Front desk workstation' });
    }
  }, HOOK_TIMEOUT);
});
