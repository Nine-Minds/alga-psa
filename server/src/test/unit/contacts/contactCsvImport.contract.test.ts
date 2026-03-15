import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IContact } from '@alga-psa/types';

const testState = vi.hoisted(() => ({
  tenant: 'test-tenant',
  userId: 'test-user',
  trx: undefined as any,
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
  createTagMock: vi.fn(),
  publishWorkflowEventMock: vi.fn(),
  createContactMock: vi.fn(),
  updateContactMock: vi.fn(),
  getContactByIdMock: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: testState.userId, tenant: testState.tenant }, { tenant: testState.tenant }, ...args),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: testState.createTenantKnexMock,
    withTransaction: testState.withTransactionMock,
  };
});

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: testState.createTagMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: testState.publishWorkflowEventMock,
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: testState.createContactMock,
    updateContact: testState.updateContactMock,
    getContactById: testState.getContactByIdMock,
  },
}));

import { importContactsFromCSV } from '../../../../../packages/clients/src/actions/contact-actions/contactActions';

type FakeQuery = {
  select: (..._args: any[]) => FakeQuery;
  whereIn: (..._args: any[]) => FakeQuery;
  andWhere: (..._args: any[]) => Promise<any[]>;
  where: (..._args: any[]) => FakeQuery;
  first: () => Promise<any>;
  delete: () => Promise<number>;
};

function makeQuery(rows: any[] = [], firstRow?: any): FakeQuery {
  return {
    select: () => makeQuery(rows, firstRow),
    whereIn: () => makeQuery(rows, firstRow),
    andWhere: async () => rows,
    where: () => makeQuery(rows, firstRow),
    first: async () => firstRow,
    delete: async () => 0,
  };
}

function makeTrx(config: {
  directMatches?: Array<{ contact_name_id: string }>;
  additionalMatches?: Array<{ contact_name_id: string }>;
  nameMatch?: { contact_name_id: string } | undefined;
}) {
  return ((table: string) => {
    if (table === 'contacts') {
      return makeQuery(config.directMatches ?? [], config.nameMatch);
    }

    if (table === 'contact_additional_email_addresses') {
      return makeQuery(config.additionalMatches ?? [], undefined);
    }

    if (table === 'tag_mappings') {
      return makeQuery([], undefined);
    }

    throw new Error(`Unexpected table ${table}`);
  }) as any;
}

describe('contact CSV import action contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: testState.tenant });
    testState.withTransactionMock.mockImplementation(async (_knexLike: any, callback: (trx: any) => Promise<unknown>) =>
      callback(testState.trx)
    );
  });

  it('T029: CSV import creates a contact with primary and additional email rows', async () => {
    testState.trx = makeTrx({});
    testState.createContactMock.mockImplementation(async (input: any) => ({
      contact_name_id: 'contact-created',
      ...input,
      additional_email_addresses: input.additional_email_addresses,
    }));

    const results = await importContactsFromCSV([
      {
        full_name: 'Hybrid CSV Contact',
        email: 'owner@acme.com',
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: 'billing@acme.com',
            canonical_type: 'billing',
            custom_type: null,
            display_order: 0,
          },
          {
            email_address: 'alerts@acme.com',
            canonical_type: null,
            custom_type: 'Escalations',
            display_order: 1,
          },
        ],
      } as any,
    ], false);

    expect(testState.createContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        full_name: 'Hybrid CSV Contact',
        email: 'owner@acme.com',
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          expect.objectContaining({
            email_address: 'billing@acme.com',
            canonical_type: 'billing',
            custom_type: null,
          }),
          expect.objectContaining({
            email_address: 'alerts@acme.com',
            canonical_type: null,
            custom_type: 'Escalations',
          }),
        ],
      }),
      testState.tenant,
      testState.trx
    );

    expect(results[0]).toMatchObject({
      success: true,
      contact: expect.objectContaining({
        email: 'owner@acme.com',
      }),
    });
  });

  it('T029: CSV import updates an existing contact with primary and additional email rows', async () => {
    const existingContact: IContact = {
      contact_name_id: 'contact-existing',
      full_name: 'Hybrid CSV Contact',
      client_id: null,
      phone_numbers: [],
      default_phone_number: null,
      default_phone_type: null,
      primary_email_canonical_type: 'work',
      primary_email_custom_type_id: null,
      primary_email_type: 'work',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: 'email-1',
          email_address: 'billing@acme.com',
          normalized_email_address: 'billing@acme.com',
          canonical_type: 'billing',
          custom_email_type_id: null,
          custom_type: null,
          display_order: 0,
        },
      ],
      email: 'owner@acme.com',
      role: null,
      notes: null,
      is_inactive: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    testState.trx = makeTrx({
      directMatches: [{ contact_name_id: existingContact.contact_name_id }],
    });
    testState.getContactByIdMock.mockResolvedValue(existingContact);
    testState.updateContactMock.mockImplementation(async (_contactId: string, input: any) => ({
      ...existingContact,
      ...input,
      additional_email_addresses: input.additional_email_addresses,
    }));

    const results = await importContactsFromCSV([
      {
        full_name: 'Hybrid CSV Contact',
        email: 'billing@acme.com',
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          {
            email_address: 'owner@acme.com',
            canonical_type: 'work',
            custom_type: null,
            display_order: 0,
          },
          {
            email_address: 'alerts@acme.com',
            canonical_type: null,
            custom_type: 'Escalations',
            display_order: 1,
          },
        ],
        role: 'Billing Owner',
      } as any,
    ], true);

    expect(testState.updateContactMock).toHaveBeenCalledWith(
      existingContact.contact_name_id,
      expect.objectContaining({
        full_name: 'Hybrid CSV Contact',
        email: 'billing@acme.com',
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          expect.objectContaining({
            email_address: 'alerts@acme.com',
            canonical_type: null,
            custom_type: 'Escalations',
          }),
          expect.objectContaining({
            email_address: 'billing@acme.com',
            canonical_type: 'billing',
            custom_type: null,
          }),
        ],
        role: 'Billing Owner',
      }),
      testState.tenant,
      testState.trx
    );

    expect(results[0]).toMatchObject({
      success: true,
      contact: expect.objectContaining({
        email: 'billing@acme.com',
        role: 'Billing Owner',
      }),
    });
  });
});
