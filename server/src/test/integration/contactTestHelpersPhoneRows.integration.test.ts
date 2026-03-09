import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import path from 'path';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { contactFactory } from '../e2e/factories/contact.factory';
import { createTestContact } from '../e2e/utils/contactTestDataFactory';

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Helper Tenant ${tenantId.slice(0, 6)}`,
    email: `${tenantId.slice(0, 6)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function createClient(db: Knex, tenantId: string, clientId: string, clientName: string) {
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: clientName,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

describe('contact test helper normalized phone rows integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T035: createTestContact stores contact phone data in contact_phone_numbers and leaves contacts.phone_number empty', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, `Helper Client ${clientId.slice(0, 6)}`);

    const contact = await createTestContact(db, tenantId, {
      client_id: clientId,
      full_name: 'Factory Contact',
      email: `factory-${tenantId}@example.com`,
      phone_number: '555-0100',
    });

    const storedContact = await db('contacts')
      .where({ tenant: tenantId, contact_name_id: contact.contact_name_id })
      .first<{ phone_number: string | null }>();
    const storedPhoneRows = await db('contact_phone_numbers')
      .where({ tenant: tenantId, contact_name_id: contact.contact_name_id })
      .orderBy('display_order', 'asc');

    expect(storedContact?.phone_number ?? null).toBeNull();
    expect(contact.default_phone_number).toBe('555-0100');
    expect(storedPhoneRows).toHaveLength(1);
    expect(storedPhoneRows[0]).toMatchObject({
      phone_number: '555-0100',
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
    });
  });

  it('T035: contactFactory writes normalized default rows instead of contacts.phone_number', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, `Factory Client ${clientId.slice(0, 6)}`);

    const contact = await contactFactory(db, {
      tenant: tenantId,
      client_id: clientId,
      full_name: 'Factory Helper',
      email: `factory-helper-${tenantId}@example.com`,
      phone_number: '555-0200',
    });

    const storedContact = await db('contacts')
      .where({ tenant: tenantId, contact_name_id: contact.contact_name_id })
      .first<{ phone_number: string | null }>();
    const storedPhoneRows = await db('contact_phone_numbers')
      .where({ tenant: tenantId, contact_name_id: contact.contact_name_id })
      .orderBy('display_order', 'asc');

    expect(storedContact?.phone_number ?? null).toBeNull();
    expect(contact.default_phone_number).toBe('555-0200');
    expect(storedPhoneRows).toHaveLength(1);
    expect(storedPhoneRows[0]).toMatchObject({
      phone_number: '555-0200',
      canonical_type: 'work',
      is_default: true,
    });
  });

  it('T035: dev contact seed inserts normalized phone rows instead of writing contacts.phone_number directly', () => {
    const seedSource = readFileSync(
      path.resolve(__dirname, '../../../seeds/dev/05_contacts.cjs'),
      'utf8'
    );

    expect(seedSource).toContain("await knex('contact_phone_numbers').insert([");
    expect(seedSource).toContain("canonical_type: 'work'");
    expect(seedSource).toContain("is_default: true");
    expect(seedSource).not.toContain("phone_number: '+1-555-987-6543',\n            email");
  });
});
