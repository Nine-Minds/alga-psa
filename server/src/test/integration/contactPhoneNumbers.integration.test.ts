import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

describe('contact phone numbers integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T006: stores normalized_phone_number independently of display formatting', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const phoneRowId = '33333333-3333-4333-8333-333333333333';
    const formattedPhone = '(555) 010-1234';

    await db('tenants').insert({
      tenant: tenantId,
      client_name: 'Contact Phone Test Tenant',
      email: 'tenant@example.com',
    });

    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Phone Test Contact',
      email: 'contact@example.com',
      phone_number: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('contact_phone_numbers').insert({
      tenant: tenantId,
      contact_phone_number_id: phoneRowId,
      contact_name_id: contactId,
      phone_number: formattedPhone,
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
    });

    const storedRow = await db('contact_phone_numbers')
      .where({ tenant: tenantId, contact_phone_number_id: phoneRowId })
      .first<{
        contact_phone_number_id: string;
        normalized_phone_number: string;
      }>();

    expect(storedRow?.normalized_phone_number).toBe('5550101234');

    const matchedByDigits = await db('contact_phone_numbers')
      .where({
        tenant: tenantId,
        normalized_phone_number: '5550101234',
      })
      .first<{ contact_phone_number_id: string }>();

    expect(matchedByDigits?.contact_phone_number_id).toBe(phoneRowId);
  });
});
