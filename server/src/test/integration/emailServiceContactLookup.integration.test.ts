import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ContactModel } from '../../../../shared/models/contactModel';
import { createEmailService } from '../../../../shared/services/emailService';

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Email Service Tenant ${tenantId.slice(0, 6)}`,
    email: `${tenantId.slice(0, 6)}@example.com`,
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

describe('EmailService contact lookup', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T033: EmailService.findContactByEmail preserves the matched sender email and the contact primary email when an additional row matched', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, 'Email Service Client');

    const createdContact = await db.transaction((trx) =>
      ContactModel.createContact({
        full_name: 'Email Service Contact',
        email: `primary-${tenantId}@acme.com`,
        client_id: clientId,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: `billing-${tenantId}@acme.com`,
            canonical_type: 'billing',
            custom_type: null,
            display_order: 0,
          },
        ],
        phone_numbers: [
          {
            phone_number: '555-1000',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
          },
        ],
      }, tenantId, trx)
    );

    const trx = await db.transaction();
    try {
      const emailService = createEmailService(trx, tenantId);
      const foundContact = await emailService.findContactByEmail(`billing-${tenantId}@acme.com`);

      await trx.rollback();

      expect(foundContact).toMatchObject({
        contact_id: createdContact.contact_name_id,
        name: 'Email Service Contact',
        email: `primary-${tenantId}@acme.com`,
        matched_email: `billing-${tenantId}@acme.com`,
        client_id: clientId,
        client_name: 'Email Service Client',
        phone: '555-1000',
      });
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  });

  it('T034: EmailService.createOrFindContact creates contacts with only a primary email in contacts.email when no match exists', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, 'Create Contact Client');

    const trx = await db.transaction();
    try {
      const emailService = createEmailService(trx, tenantId);
      const result = await emailService.createOrFindContact({
        email: `new-email-service-${tenantId}@acme.com`,
        name: 'Created By Email Service',
        client_id: clientId,
        phone: '555-2000',
        title: 'Coordinator',
      });

      await trx.commit();

      expect(result).toMatchObject({
        name: 'Created By Email Service',
        email: `new-email-service-${tenantId}@acme.com`,
        client_id: clientId,
        phone: '555-2000',
        title: 'Coordinator',
        is_new: true,
      });

      const storedContact = await db('contacts')
        .where({ tenant: tenantId, contact_name_id: result.id })
        .first();
      expect(storedContact?.email).toBe(`new-email-service-${tenantId}@acme.com`);

      const storedAdditionalRows = await db('contact_additional_email_addresses')
        .where({ tenant: tenantId, contact_name_id: result.id });
      expect(storedAdditionalRows).toEqual([]);
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  });

  it('EmailService.createOrFindContact reuses an existing contact when an additional email matches', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId, 'Existing Email Service Client');

    const createdContact = await db.transaction((trx) =>
      ContactModel.createContact({
        full_name: 'Existing Email Service Contact',
        email: `primary-${tenantId}@acme.com`,
        client_id: clientId,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: `afterhours-${tenantId}@acme.com`,
            canonical_type: null,
            custom_type: 'After Hours',
            display_order: 0,
          },
        ],
        phone_numbers: [],
      }, tenantId, trx)
    );

    const trx = await db.transaction();
    try {
      const emailService = createEmailService(trx, tenantId);
      const result = await emailService.createOrFindContact({
        email: `afterhours-${tenantId}@acme.com`,
        client_id: clientId,
      });

      await trx.commit();

      expect(result.is_new).toBe(false);
      expect(result.id).toBe(createdContact.contact_name_id);
      expect(result.email).toBe(`primary-${tenantId}@acme.com`);
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  });
});
