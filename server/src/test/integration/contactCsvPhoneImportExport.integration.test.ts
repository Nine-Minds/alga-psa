import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { parseCSV } from '@alga-psa/core';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const testState = vi.hoisted(() => ({
  tenant: 'test-tenant',
  userId: 'test-user',
  canCreateTags: true,
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
  createTagMock: vi.fn().mockResolvedValue(undefined),
  actualWithTransaction: undefined as undefined | ((...args: any[]) => Promise<any>),
  publishWorkflowEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(
      { user_id: testState.userId, tenant: testState.tenant, user_type: 'internal' },
      { tenant: testState.tenant },
      ...args
    ),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(
      { user_id: testState.userId, tenant: testState.tenant, user_type: 'internal' },
      { tenant: testState.tenant },
      ...args
    ),
  hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  testState.actualWithTransaction = actual.withTransaction;
  return {
    ...actual,
    createTenantKnex: testState.createTenantKnexMock,
    withTransaction: testState.withTransactionMock,
  };
});

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: testState.createTagMock,
}));

// The suite's actor is not a seeded user; grant the tag:create gate so imported
// tags can mint their definitions.
vi.mock('../../../../packages/tags/src/lib/authHelpers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  hasPermissionAsync: vi.fn(async (_user: any, resource: string, action: string) =>
    resource === 'tag' && action === 'create' ? testState.canCreateTags : true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: testState.publishWorkflowEventMock,
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import {
  exportContactsToCSV,
  generateContactCSVTemplate,
  importContactsFromCSV,
} from '../../../../packages/clients/src/actions/contact-actions/contactActions';
import { buildContactCsvImportRows } from '../../../../packages/clients/src/lib/contactCsvImportPayload';

async function createTenant(db: Knex, tenantId: string) {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Contact CSV Tenant ${tenantId.slice(0, 6)}`,
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

const contactsImportDialogSource = readFileSync(
  new URL('../../../../packages/clients/src/components/contacts/ContactsImportDialog.tsx', import.meta.url),
  'utf8'
);

describe('contact CSV hybrid email import/export integration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testState.createTenantKnexMock.mockImplementation(async () => ({
      knex: db,
      tenant: testState.tenant,
    }));
    testState.withTransactionMock.mockImplementation(async (knexLike: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      knexLike.transaction((trx) => callback(trx))
    );
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('imports one phone column as the default work phone row', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    const results = await importContactsFromCSV([
      {
        full_name: 'CSV Import Contact',
        email: `csv-import-${tenantId}@acme.com`,
        phone_number: '+12125550109',
        client_id: clientId,
      } as any,
    ], false);

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.contact?.default_phone_number).toBe('+12125550109');
    expect(results[0]?.contact?.phone_numbers).toHaveLength(1);
    expect(results[0]?.contact?.phone_numbers[0]).toMatchObject({
      phone_number: '+12125550109',
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
    });

    const storedPhoneRows = await db('contact_phone_numbers')
      .where({
        tenant: tenantId,
        contact_name_id: results[0]!.contact!.contact_name_id,
      })
      .orderBy('display_order', 'asc');

    expect(storedPhoneRows).toHaveLength(1);
    expect(storedPhoneRows[0]).toMatchObject({
      phone_number: '+12125550109',
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
    });
  });

  describe('Tags presence (real tag writer)', () => {
    const tagsOf = async (tenantId: string, contactId: string) => (await db('tag_mappings as tm')
      .join('tag_definitions as td', function () { this.on('td.tag_id', 'tm.tag_id').andOn('td.tenant', 'tm.tenant'); })
      .where({ 'tm.tenant': tenantId, 'tm.tagged_id': contactId, 'tm.tagged_type': 'contact' })
      .pluck('td.tag_text')).sort();

    const mappingCount = async (tenantId: string, contactId: string) => Number(
      (await db('tag_mappings').where({ tenant: tenantId, tagged_id: contactId, tagged_type: 'contact' })
        .count<{ count: string }[]>('* as count').first())?.count ?? 0
    );

    const tagEvents = () => testState.publishWorkflowEventMock.mock.calls
      .map(([event]) => event)
      .filter((event: any) => event?.eventType === 'TAG_APPLIED' || event?.eventType === 'TAG_DEFINITION_CREATED');

    // Unlike the rest of this file, run the real withTransaction so the
    // after-commit hooks flush exactly as they do in production.
    beforeEach(() => {
      testState.canCreateTags = true;
      testState.withTransactionMock.mockImplementation((knexLike: Knex, callback: any) =>
        testState.actualWithTransaction!(knexLike, callback));
    });

    const seedTenant = async () => {
      const tenantId = uuidv4();
      const clientId = uuidv4();
      testState.tenant = tenantId;
      // Tag mappings record their creator, so the actor must be a real user.
      testState.userId = uuidv4();
      await createTenant(db, tenantId);
      await db('users').insert({ tenant: tenantId, user_id: testState.userId, username: testState.userId,
        email: `${testState.userId}@example.test`, first_name: 'CSV', last_name: 'Importer', user_type: 'internal',
        hashed_password: 'unused' });
      await createClient(db, tenantId, clientId);
      return { tenantId, clientId };
    };

    const seedTaggedContact = async () => {
      const { tenantId, clientId } = await seedTenant();
      const email = `tagged-${tenantId}@acme.com`;
      const [created] = await importContactsFromCSV([
        { full_name: 'Tagged CSV Contact', email, client_id: clientId, tags: 'VIP, Board' } as any,
      ], false);
      expect(created?.success).toBe(true);
      const contactId = created!.contact!.contact_name_id;
      expect(await tagsOf(tenantId, contactId)).toEqual(['Board', 'VIP']);
      return { tenantId, clientId, email, contactId };
    };

    const settlesWithin5s = <T,>(work: Promise<T>) => Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('import did not settle within 5s (hang)')), 5000)),
    ]);

    it('re-imports an overlapping tag set without hanging and leaves one mapping per tag', async () => {
      const { tenantId, clientId, email, contactId } = await seedTaggedContact();

      const results = await settlesWithin5s(importContactsFromCSV([
        { full_name: 'Tagged CSV Contact', email, client_id: clientId, tags: 'Board, Newcomer' } as any,
      ], true));

      expect(results).toEqual([expect.objectContaining({ success: true })]);
      expect(await tagsOf(tenantId, contactId)).toEqual(['Board', 'Newcomer']);
      expect(await mappingCount(tenantId, contactId)).toBe(2);
    }, 20_000);

    it('de-duplicates repeated tag texts case-insensitively into one mapping', async () => {
      const { tenantId, clientId } = await seedTenant();

      const [created] = await settlesWithin5s(importContactsFromCSV([
        { full_name: 'Dup Tags', email: `dup-${tenantId}@acme.com`, client_id: clientId, tags: 'VIP, vip , VIP,  ,' } as any,
      ], false));

      expect(created?.success).toBe(true);
      const contactId = created!.contact!.contact_name_id;
      expect(await mappingCount(tenantId, contactId)).toBe(1);
      expect(await tagsOf(tenantId, contactId)).toEqual(['VIP']);
    }, 20_000);

    it('skips an invalid tag with a warning while the row and its valid tags still commit', async () => {
      const { tenantId, clientId } = await seedTenant();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const [created] = await importContactsFromCSV([
          { full_name: 'Mixed Tags', email: `mixed-${tenantId}@acme.com`, client_id: clientId,
            tags: `Good, café, ${'x'.repeat(51)}, Fine` } as any,
        ], false);

        expect(created?.success).toBe(true);
        const contactId = created!.contact!.contact_name_id;
        expect(await tagsOf(tenantId, contactId)).toEqual(['Fine', 'Good']);
        expect(await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).first())
          .toMatchObject({ full_name: 'Mixed Tags' });
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Skipping invalid tag during CSV import'),
          expect.anything(),
        );
      } finally {
        warn.mockRestore();
      }
    }, 20_000);

    it('publishes tag events only after the import commits', async () => {
      const { tenantId, clientId } = await seedTenant();
      const email = `events-${tenantId}@acme.com`;
      const visibleAtPublish: boolean[] = [];
      testState.publishWorkflowEventMock.mockImplementation(async (event: any) => {
        if (event?.eventType === 'TAG_APPLIED') {
          // A separate connection only sees the mapping once the import committed.
          const row = await db('tag_mappings').where({ tenant: tenantId, tag_id: event.payload.tagId }).first();
          visibleAtPublish.push(Boolean(row));
        }
      });

      const [created] = await importContactsFromCSV([
        { full_name: 'Event Tags', email, client_id: clientId, tags: 'Alpha, Beta' } as any,
      ], false);

      expect(created?.success).toBe(true);
      expect(tagEvents().filter((event: any) => event.eventType === 'TAG_APPLIED')).toHaveLength(2);
      expect(tagEvents().filter((event: any) => event.eventType === 'TAG_DEFINITION_CREATED')).toHaveLength(2);
      expect(visibleAtPublish).toEqual([true, true]);
    }, 20_000);

    it('publishes no tag events and writes nothing when the import rolls back', async () => {
      const { tenantId, clientId } = await seedTenant();
      const email = `rollback-${tenantId}@acme.com`;
      // Fail the owning transaction after the callback (and its tag writes) completed.
      testState.withTransactionMock.mockImplementation((knexLike: Knex, callback: any) =>
        testState.actualWithTransaction!(knexLike, async (trx: Knex.Transaction) => {
          await callback(trx);
          throw new Error('import rolled back');
        }));
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await importContactsFromCSV([
          { full_name: 'Rolled Back', email, client_id: clientId, tags: 'Ghost' } as any,
        ], false).catch(() => undefined);
      } finally {
        error.mockRestore();
      }

      expect(tagEvents()).toEqual([]);
      expect(await db('contacts').where({ tenant: tenantId, email }).first()).toBeUndefined();
      expect(Number((await db('tag_mappings').where({ tenant: tenantId }).count<{ count: string }[]>('* as count').first())?.count)).toBe(0);
    }, 20_000);

    it('keeps existing tags when a mapped Tags cell is blank', async () => {
      const { tenantId, clientId, email, contactId } = await seedTaggedContact();
      testState.publishWorkflowEventMock.mockClear();

      // Built by the dialog's transformation from a mapped Tags column with a blank cell.
      const rows = buildContactCsvImportRows(
        [{ full_name: 'Tagged CSV Contact', email, client: 'Tagged Client', tags: '' }],
        ['full_name', 'email', 'client', 'tags'].map((field) => ({ csvHeader: field, contactField: field as any })),
        [{ client_id: clientId, client_name: 'Tagged Client' }],
      );
      expect(Object.prototype.hasOwnProperty.call(rows[0], 'tags')).toBe(false);

      const results = await importContactsFromCSV(rows, true);

      expect(results).toEqual([expect.objectContaining({ success: true, message: 'Contact updated successfully' })]);
      expect(await tagsOf(tenantId, contactId)).toEqual(['Board', 'VIP']);
      expect(tagEvents()).toEqual([]);
    }, 20_000);

    it('keeps existing tags when the action itself receives a blank tags value', async () => {
      const { tenantId, clientId, email, contactId } = await seedTaggedContact();
      testState.publishWorkflowEventMock.mockClear();

      for (const tags of ['', '   ']) {
        const results = await importContactsFromCSV([
          { full_name: 'Tagged CSV Contact', email, client_id: clientId, tags } as any,
        ], true);
        expect(results).toEqual([expect.objectContaining({ success: true })]);
      }

      expect(await tagsOf(tenantId, contactId)).toEqual(['Board', 'VIP']);
      expect(tagEvents()).toEqual([]);
    }, 20_000);

    it('publishes no events and keeps the original tags when a new tag is refused after an existing one was mapped', async () => {
      const { tenantId, clientId, email, contactId } = await seedTaggedContact();
      // Make VIP the only pre-existing definition the replacement can reuse: Board stays
      // defined too, but 'Fresh' does not exist and the importer may not create it.
      testState.canCreateTags = false;
      testState.publishWorkflowEventMock.mockClear();

      const results = await settlesWithin5s(importContactsFromCSV([
        { full_name: 'Tagged CSV Contact', email, client_id: clientId, tags: 'VIP, Fresh' } as any,
      ], true));

      // The tag savepoint rolled back (replace-delete and the VIP mapping with it)...
      expect(await tagsOf(tenantId, contactId)).toEqual(['Board', 'VIP']);
      expect(await mappingCount(tenantId, contactId)).toBe(2);
      // ...so the VIP mapping that was queued before the refusal must not be announced.
      expect(tagEvents()).toEqual([]);
      expect(results).toHaveLength(1);
    }, 20_000);

    it('replaces the tag set when the Tags cell is non-blank', async () => {
      const { tenantId, clientId, email, contactId } = await seedTaggedContact();

      const results = await importContactsFromCSV([
        { full_name: 'Tagged CSV Contact', email, client_id: clientId, tags: 'Replacement' } as any,
      ], true);

      expect(results).toEqual([expect.objectContaining({ success: true })]);
      expect(await tagsOf(tenantId, contactId)).toEqual(['Replacement']);
    }, 20_000);

    it('leaves existing tags in place when the import carries no Tags column', async () => {
      const { tenantId, clientId, email, contactId } = await seedTaggedContact();

      const results = await importContactsFromCSV([
        { full_name: 'Renamed CSV Contact', email, client_id: clientId } as any,
      ], true);

      expect(results).toEqual([expect.objectContaining({ success: true })]);
      expect(await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).first())
        .toMatchObject({ full_name: 'Renamed CSV Contact' });
      expect(await tagsOf(tenantId, contactId)).toEqual(['Board', 'VIP']);
    }, 20_000);

    it('skips a duplicate row without update-existing and changes nothing, tags included', async () => {
      const { tenantId, clientId, email, contactId } = await seedTaggedContact();
      const contactBefore = await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).first();
      const mappingsBefore = await db('tag_mappings').where({ tenant: tenantId }).orderBy('mapping_id');

      for (const tags of ['', 'Replaced']) {
        const results = await importContactsFromCSV([
          { full_name: 'Duplicate CSV Contact', email, client_id: clientId, tags } as any,
        ], false);
        expect(results).toEqual([expect.objectContaining({
          success: false,
          message: expect.stringMatching(/already exists/),
        })]);
      }

      expect(await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).first()).toEqual(contactBefore);
      expect(await db('tag_mappings').where({ tenant: tenantId }).orderBy('mapping_id')).toEqual(mappingsBefore);
    }, 20_000);
  });

  it('T028: contact CSV template and dialog copy describe primary and additional email fields', async () => {
    const csvTemplate = await generateContactCSVTemplate();
    const rows = parseCSV(csvTemplate) as string[][];

    expect(rows[0]).toEqual([
      'full_name',
      'email',
      'primary_email_type',
      'additional_email_addresses',
      'phone_number',
      'client',
      'role',
      'notes',
      'tags',
    ]);
    expect(rows[1]?.[2]).toBe('work');
    expect(rows[1]?.[3]).toContain('personal:alice.home@wonderland.com');
    expect(rows[1]?.[3]).toContain('billing:accounts@wonderland.com');

    expect(contactsImportDialogSource).toContain(
      "primary_email_type: t('contactsImportDialog.fields.primaryEmailLabel', { defaultValue: 'Primary Email Label' })"
    );
    expect(contactsImportDialogSource).toContain(
      "additional_email_addresses: t('contactsImportDialog.fields.additionalEmails', { defaultValue: 'Additional Email Addresses' })"
    );
    expect(contactsImportDialogSource).toContain('primary_email_type (work/personal/billing/other or a custom label)');
    expect(contactsImportDialogSource).toContain('additional_email_addresses (use `label:email@example.com | label:email@example.com`)');
    expect(contactsImportDialogSource).toContain('CSV import/export keeps `email` as the primary/default contact email.');
  });

  it('T029: CSV import creates and updates a contact with primary and additional email rows', async () => {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    testState.tenant = tenantId;

    await createTenant(db, tenantId);
    await createClient(db, tenantId, clientId);

    const createResults = await importContactsFromCSV([
      {
        full_name: 'Hybrid CSV Contact',
        email: `owner-${tenantId}@acme.com`,
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: `billing-${tenantId}@acme.com`,
            canonical_type: 'billing',
            custom_type: null,
            display_order: 0,
          },
          {
            email_address: `alerts-${tenantId}@acme.com`,
            canonical_type: null,
            custom_type: 'Escalations',
            display_order: 1,
          },
        ],
        phone_number: '+12125550109',
        client_id: clientId,
      } as any,
    ], false);

    expect(createResults).toHaveLength(1);
    expect(createResults[0]?.success).toBe(true);
    expect(createResults[0]?.contact).toMatchObject({
      email: `owner-${tenantId}@acme.com`,
      primary_email_canonical_type: 'work',
    });
    expect(createResults[0]?.contact?.additional_email_addresses).toEqual([
      expect.objectContaining({
        email_address: `billing-${tenantId}@acme.com`,
        canonical_type: 'billing',
        custom_type: null,
        display_order: 0,
      }),
      expect.objectContaining({
        email_address: `alerts-${tenantId}@acme.com`,
        canonical_type: null,
        custom_type: 'Escalations',
        display_order: 1,
      }),
    ]);

    const updateResults = await importContactsFromCSV([
      {
        full_name: 'Hybrid CSV Contact',
        email: `billing-${tenantId}@acme.com`,
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          {
            email_address: `owner-${tenantId}@acme.com`,
            canonical_type: 'work',
            custom_type: null,
            display_order: 0,
          },
          {
            email_address: `alerts-${tenantId}@acme.com`,
            canonical_type: null,
            custom_type: 'Escalations',
            display_order: 1,
          },
          {
            email_address: `personal-${tenantId}@acme.com`,
            canonical_type: 'personal',
            custom_type: null,
            display_order: 2,
          },
        ],
        client_id: clientId,
        role: 'Billing Owner',
      } as any,
    ], true);

    expect(updateResults).toHaveLength(1);
    expect(updateResults[0]?.success).toBe(true);
    expect(updateResults[0]?.contact).toMatchObject({
      email: `billing-${tenantId}@acme.com`,
      primary_email_canonical_type: 'billing',
      role: 'Billing Owner',
    });
    expect(updateResults[0]?.contact?.additional_email_addresses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email_address: `owner-${tenantId}@acme.com`,
        canonical_type: 'work',
        custom_type: null,
      }),
      expect.objectContaining({
        email_address: `alerts-${tenantId}@acme.com`,
        canonical_type: null,
        custom_type: 'Escalations',
      }),
      expect.objectContaining({
        email_address: `personal-${tenantId}@acme.com`,
        canonical_type: 'personal',
        custom_type: null,
      }),
    ]));
    expect(updateResults[0]?.contact?.additional_email_addresses).toHaveLength(3);

    const storedContact = await db('contacts')
      .where({ tenant: tenantId, contact_name_id: updateResults[0]!.contact!.contact_name_id })
      .first();
    expect(storedContact?.email).toBe(`billing-${tenantId}@acme.com`);

    const storedAdditionalRows = await db('contact_additional_email_addresses')
      .where({ tenant: tenantId, contact_name_id: updateResults[0]!.contact!.contact_name_id })
      .orderBy('display_order', 'asc');

    expect(storedAdditionalRows.map((row) => row.email_address)).toEqual([
      `alerts-${tenantId}@acme.com`,
      `personal-${tenantId}@acme.com`,
      `owner-${tenantId}@acme.com`,
    ]);
  });

  it('T030: contact CSV export includes primary email labels and additional-email rows while keeping the derived default phone', async () => {
    const csv = await exportContactsToCSV(
      [
        {
          contact_name_id: 'contact-1',
          full_name: 'CSV Export Contact',
          email: 'csv-export@acme.com',
          primary_email_canonical_type: null,
          primary_email_type: 'Escalations',
          additional_email_addresses: [
            {
              contact_additional_email_address_id: 'email-1',
              email_address: 'billing@acme.com',
              normalized_email_address: 'billing@acme.com',
              canonical_type: 'billing',
              custom_type: null,
              display_order: 0,
            },
            {
              contact_additional_email_address_id: 'email-2',
              email_address: 'afterhours@acme.com',
              normalized_email_address: 'afterhours@acme.com',
              canonical_type: null,
              custom_type: 'After Hours',
              display_order: 1,
            },
          ],
          client_id: 'client-1',
          role: 'Coordinator',
          notes: 'Export test',
          default_phone_number: null,
          phone_numbers: [
            {
              contact_phone_number_id: 'phone-1',
              phone_number: '555-0000',
              normalized_phone_number: '5550000',
              canonical_type: 'work',
              custom_type: null,
              is_default: false,
              display_order: 0,
            },
            {
              contact_phone_number_id: 'phone-2',
              phone_number: '555-1111',
              normalized_phone_number: '5551111',
              canonical_type: 'mobile',
              custom_type: null,
              is_default: true,
              display_order: 1,
            },
          ],
        } as any,
      ],
      [
        {
          client_id: 'client-1',
          client_name: 'Acme Client',
        } as any,
      ],
      { 'contact-1': [] }
    );

    const rows = parseCSV(csv) as string[][];
    expect(rows[0]).toEqual([
      'full_name',
      'email',
      'primary_email_type',
      'additional_email_addresses',
      'phone_number',
      'client',
      'role',
      'notes',
      'tags',
    ]);
    expect(rows[1]).toEqual([
      'CSV Export Contact',
      'csv-export@acme.com',
      'Escalations',
      'billing: billing@acme.com | After Hours: afterhours@acme.com',
      '555-1111',
      'Acme Client',
      'Coordinator',
      'Export test',
      '',
    ]);
  });

});
