import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { ContactService } from '../../lib/api/services/ContactService';

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
}));

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Contact Service Tenant ${tenantId.slice(0, 6)}`,
    email: `${tenantId.slice(0, 6)}@example.com`,
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

describe('contact service normalized phone search and sort integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T024: search returns a contact when the query matches a secondary non-default phone row', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    const service = new ContactService();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });

    await db.transaction(async (trx) => {
      await ContactModel.createContact({
        full_name: 'Secondary Match Contact',
        email: `search-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [
          {
            phone_number: '555-1000',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
          {
            phone_number: '(555) 777-8888',
            canonical_type: 'mobile',
            is_default: false,
            display_order: 1,
          },
        ],
      }, tenantId, trx);
    });

    const results = await service.search({
      query: '7778888',
      fields: ['phone_number'],
      include_inactive: false,
      limit: 10,
    }, {
      tenant: tenantId,
      userId: 'test-user',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.full_name).toBe('Secondary Match Contact');
    expect(results[0]?.default_phone_number).toBe('555-1000');
    expect(results[0]?.phone_numbers.find((row) => row.is_default)?.phone_number).toBe('555-1000');
  });

  it('T025: list sorting by phone_number uses the derived default phone row instead of an arbitrary child row', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    const service = new ContactService();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });

    await db.transaction(async (trx) => {
      await ContactModel.createContact({
        full_name: 'Zulu Contact',
        email: `zulu-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [
          {
            phone_number: '999-0000',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
          {
            phone_number: '000-0001',
            canonical_type: 'mobile',
            is_default: false,
            display_order: 1,
          },
        ],
      }, tenantId, trx);

      await ContactModel.createContact({
        full_name: 'Alpha Contact',
        email: `alpha-${tenantId}@example.com`,
        client_id: clientId,
        phone_numbers: [
          {
            phone_number: '111-0000',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
          {
            phone_number: '999-9999',
            canonical_type: 'mobile',
            is_default: false,
            display_order: 1,
          },
        ],
      }, tenantId, trx);
    });

    const result = await service.list({
      page: 1,
      limit: 10,
      sort: 'phone_number',
      order: 'asc',
      filters: {},
    }, {
      tenant: tenantId,
      userId: 'test-user',
    });

    expect(result.data.map((contact) => contact.full_name)).toEqual([
      'Alpha Contact',
      'Zulu Contact',
    ]);
    expect(result.data.map((contact) => contact.default_phone_number)).toEqual([
      '111-0000',
      '999-0000',
    ]);
  });
});
