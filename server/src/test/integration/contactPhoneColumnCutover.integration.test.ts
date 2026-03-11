import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { knex as createKnex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ContactService } from '../../lib/api/services/ContactService';

const migration = require('../../../migrations/20260309183000_drop_contacts_phone_number_column.cjs');

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

async function hasPhoneNumberColumn(db: Knex): Promise<boolean> {
  const column = await db('information_schema.columns')
    .where({
      table_schema: 'public',
      table_name: 'contacts',
      column_name: 'phone_number',
    })
    .first();

  return Boolean(column);
}

async function ensurePhoneNumberColumnState(db: Knex, shouldExist: boolean): Promise<void> {
  const exists = await hasPhoneNumberColumn(db);
  if (exists === shouldExist) {
    return;
  }

  if (shouldExist) {
    await db.schema.alterTable('contacts', (table) => {
      table.text('phone_number');
    });
    return;
  }

  await db.schema.alterTable('contacts', (table) => {
    table.dropColumn('phone_number');
  });
}

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Cutover Tenant ${tenantId.slice(0, 6)}`,
    email: `${tenantId.slice(0, 6)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function createClient(db: Knex, tenantId: string, clientId: string) {
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${clientId.slice(0, 6)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

describe.sequential('contact phone column cutover integration', () => {
  let db: Knex;
  let adminDb: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    adminDb = createKnex({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER_ADMIN || 'postgres',
        password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
        database: process.env.DB_NAME_SERVER || 'test_database',
      },
    });
  });

  afterAll(async () => {
    if (adminDb) {
      await ensurePhoneNumberColumnState(adminDb, true);
      await adminDb.destroy();
    }
    if (db) {
      await db.destroy();
    }
  });

  it('T036: contact create/update/read flows succeed after contacts.phone_number is removed from the live schema', async () => {
    await ensurePhoneNumberColumnState(adminDb, true);
    await ensurePhoneNumberColumnState(adminDb, false);

    const tenantId = uuidv4();
    const clientId = uuidv4();
    const service = new ContactService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    const created = await service.create({
      full_name: 'Cutover Contact',
      email: `cutover-${tenantId}@example.com`,
      client_id: clientId,
      phone_numbers: [{
        phone_number: '555-3000',
        canonical_type: 'work',
        is_default: true,
        display_order: 0,
      }],
      role: 'Manager',
    }, {
      tenant: tenantId,
      userId: 'cutover-user',
    });

    expect(created.default_phone_number).toBe('555-3000');
    expect(created.phone_numbers).toHaveLength(1);

    const updated = await service.update(created.contact_name_id, {
      full_name: 'Cutover Contact Updated',
      phone_numbers: [
        {
          phone_number: '555-3001',
          canonical_type: 'mobile',
          is_default: true,
          display_order: 0,
        },
        {
          phone_number: '555-3002',
          canonical_type: 'work',
          is_default: false,
          display_order: 1,
        },
      ],
    } as any, {
      tenant: tenantId,
      userId: 'cutover-user',
    });

    expect(updated.full_name).toBe('Cutover Contact Updated');
    expect(updated.default_phone_number).toBe('555-3001');
    expect(updated.phone_numbers.map((row) => row.phone_number)).toEqual(['555-3001', '555-3002']);

    const loaded = await service.getById(created.contact_name_id, {
      tenant: tenantId,
      userId: 'cutover-user',
    });

    expect(loaded).not.toBeNull();
    expect(loaded?.default_phone_number).toBe('555-3001');
    expect(loaded?.phone_numbers.map((row) => row.phone_number)).toEqual(['555-3001', '555-3002']);

    await ensurePhoneNumberColumnState(adminDb, true);
  });

  it('T037: Migration B drops contacts.phone_number and the contact service still works against the migrated schema', async () => {
    await ensurePhoneNumberColumnState(adminDb, true);

    const tenantId = uuidv4();
    const clientId = uuidv4();
    const service = new ContactService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    await migration.up(adminDb);
    expect(await hasPhoneNumberColumn(adminDb)).toBe(false);

    const created = await service.create({
      full_name: 'Migrated Contact',
      email: `migrated-${tenantId}@example.com`,
      client_id: clientId,
      phone_numbers: [{
        phone_number: '555-4000',
        canonical_type: 'work',
        is_default: true,
        display_order: 0,
      }],
    }, {
      tenant: tenantId,
      userId: 'migration-user',
    });

    expect(created.default_phone_number).toBe('555-4000');

    const loaded = await service.getById(created.contact_name_id, {
      tenant: tenantId,
      userId: 'migration-user',
    });
    expect(loaded?.default_phone_number).toBe('555-4000');

    await migration.down(adminDb);
    expect(await hasPhoneNumberColumn(adminDb)).toBe(true);
  });
});
