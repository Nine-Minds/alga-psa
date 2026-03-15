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

describe('contact test helper email rows integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T045: createTestContact stores primary email labels and additional email rows through ContactModel', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, `Helper Client ${clientId.slice(0, 6)}`);

    const contact = await createTestContact(db, tenantId, {
      client_id: clientId,
      full_name: 'Helper Contact',
      email: `primary-${tenantId}@example.com`,
      primary_email_canonical_type: 'billing',
      additional_email_addresses: [
        {
          email_address: `secondary-${tenantId}@example.com`,
          canonical_type: 'personal',
        },
      ],
    });

    const storedContact = await db('contacts')
      .where({ tenant: tenantId, contact_name_id: contact.contact_name_id })
      .first<{ primary_email_canonical_type: string | null }>();
    const storedAdditionalRows = await db('contact_additional_email_addresses')
      .where({ tenant: tenantId, contact_name_id: contact.contact_name_id })
      .orderBy('display_order', 'asc');

    expect(contact.primary_email_canonical_type).toBe('billing');
    expect(storedContact?.primary_email_canonical_type).toBe('billing');
    expect(contact.additional_email_addresses).toEqual([
      expect.objectContaining({
        email_address: `secondary-${tenantId}@example.com`,
        canonical_type: 'personal',
        display_order: 0,
      }),
    ]);
    expect(storedAdditionalRows).toEqual([
      expect.objectContaining({
        email_address: `secondary-${tenantId}@example.com`,
        canonical_type: 'personal',
        display_order: 0,
      }),
    ]);
  });

  it('T045: contactFactory accepts custom primary labels and optional additional emails', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, `Factory Client ${clientId.slice(0, 6)}`);

    const contact = await contactFactory(db, {
      tenant: tenantId,
      client_id: clientId,
      full_name: 'Factory Helper',
      email: `factory-${tenantId}@example.com`,
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          email_address: `alerts-${tenantId}@example.com`,
          custom_type: 'Notifications',
        },
      ],
    });

    const storedAdditionalRows = await db('contact_additional_email_addresses')
      .where({ tenant: tenantId, contact_name_id: contact.contact_name_id })
      .orderBy('display_order', 'asc');

    expect(contact.primary_email_type).toBe('Escalations');
    expect(contact.primary_email_canonical_type).toBeNull();
    expect(contact.additional_email_addresses).toEqual([
      expect.objectContaining({
        email_address: `alerts-${tenantId}@example.com`,
        custom_type: 'Notifications',
        display_order: 0,
      }),
    ]);
    expect(storedAdditionalRows).toEqual([
      expect.objectContaining({
        email_address: `alerts-${tenantId}@example.com`,
        custom_email_type_id: expect.any(String),
        display_order: 0,
      }),
    ]);
  });

  it('T045: dev contact seed includes primary email labels and an additional email row example', () => {
    const seedSource = readFileSync(
      path.resolve(__dirname, '../../../seeds/dev/05_contacts.cjs'),
      'utf8'
    );

    expect(seedSource).toContain("primary_email_canonical_type: 'work'");
    expect(seedSource).toContain("primary_email_canonical_type: 'personal'");
    expect(seedSource).toContain("await knex('contact_additional_email_addresses').insert([");
    expect(seedSource).toContain("canonical_type: 'billing'");
  });
});
