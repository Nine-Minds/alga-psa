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
    client_name: `Contact Email Search Tenant ${tenantId.slice(0, 6)}`,
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

describe('contact service hybrid email search integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T026: ContactService search and list filters match a contact when the query hits an additional email row', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    const service = new ContactService();
    const additionalEmail = `billing-${tenantId}@example.com`;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });

    await db.transaction(async (trx) => {
      await ContactModel.createContact({
        full_name: 'Additional Email Match Contact',
        email: `primary-${tenantId}@example.com`,
        client_id: clientId,
        additional_email_addresses: [
          {
            email_address: additionalEmail,
            canonical_type: 'billing',
            display_order: 0,
          },
        ],
      }, tenantId, trx);
    });

    const searchResults = await service.search({
      query: additionalEmail,
      fields: ['email'],
      include_inactive: false,
      limit: 10,
    }, {
      tenant: tenantId,
      userId: 'test-user',
    });

    const listResult = await service.list({
      page: 1,
      limit: 10,
      filters: { search: additionalEmail },
      sort: 'full_name',
      order: 'asc',
    }, {
      tenant: tenantId,
      userId: 'test-user',
    });

    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      full_name: 'Additional Email Match Contact',
      email: `primary-${tenantId}@example.com`,
    });

    expect(listResult.data).toHaveLength(1);
    expect(listResult.data[0]).toMatchObject({
      full_name: 'Additional Email Match Contact',
      email: `primary-${tenantId}@example.com`,
    });
  });

  it('T027: ContactService export keeps the primary email summary while allowing filters to match an additional email row', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    const service = new ContactService();
    const additionalEmail = `alerts-${tenantId}@example.com`;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });

    await db.transaction(async (trx) => {
      await ContactModel.createContact({
        full_name: 'Export Additional Email Contact',
        email: `primary-export-${tenantId}@example.com`,
        client_id: clientId,
        additional_email_addresses: [
          {
            email_address: additionalEmail,
            canonical_type: 'other',
            display_order: 0,
          },
        ],
      }, tenantId, trx);
    });

    const exportedJson = await service.exportContacts({
      email: additionalEmail,
    }, 'json', {
      tenant: tenantId,
      userId: 'test-user',
    });

    const exportedRows = JSON.parse(exportedJson) as Array<{ full_name: string; email: string }>;

    expect(exportedRows).toHaveLength(1);
    expect(exportedRows[0]).toMatchObject({
      full_name: 'Export Additional Email Contact',
      email: `primary-export-${tenantId}@example.com`,
    });
  });
});
