import { describe, expect, it } from 'vitest';

import { resolveInvoiceBillingRecipient } from '../../../../../packages/billing/src/services/invoiceBillingRecipientService';
import {
  getClientBillingEmail,
  validateClientBillingEmail,
} from '../../../../../packages/billing/src/services/invoiceService';

/**
 * Where a segmented client's invoice actually gets emailed.
 *
 * A billing profile is how a merged-in client keeps its own identity under a
 * parent: its own AP contact, its own inbox, its own bill-to name. Sending that
 * invoice to the parent's address is not a cosmetic slip — it is the invoice
 * landing on the wrong desk, which is the thing segmenting was supposed to
 * prevent. Every profile field is nullable and NULL means inherit, so a client
 * nobody segmented must resolve exactly as it did before profiles existed.
 */

const TENANT = 'tenant-1';
const CLIENT_ID = 'client-1';
const PROFILE_ID = 'profile-merged';

type Row = Record<string, any>;

function unqualify(column: string) {
  const [, unqualified] = column.match(/^(?:[^.]+)\.(.+)$/) ?? [];
  return unqualified ?? column;
}

/**
 * Minimal knex stand-in: equality where, callback where with orWhereNull,
 * select, orderBy, first, and awaiting the builder for a row list.
 */
function createMockKnex(tables: Record<string, Row[]>) {
  return ((tableName: string) => {
    let rows: Row[] = (tables[tableName] ?? []).map((row) => ({ ...row }));

    const builder: any = {
      where(criteria: any, value?: unknown) {
        if (typeof criteria === 'function') {
          const predicates: Array<(row: Row) => boolean> = [];
          const group: any = {
            where(column: string, expected: unknown) {
              predicates.push((row) => row[unqualify(column)] === expected);
              return group;
            },
            orWhere(column: string, expected: unknown) {
              predicates.push((row) => row[unqualify(column)] === expected);
              return group;
            },
            orWhereNull(column: string) {
              predicates.push((row) => row[unqualify(column)] === null || row[unqualify(column)] === undefined);
              return group;
            },
          };
          criteria(group);
          rows = rows.filter((row) => predicates.some((predicate) => predicate(row)));
          return builder;
        }

        if (typeof criteria === 'string') {
          rows = rows.filter((row) => row[unqualify(criteria)] === value);
          return builder;
        }

        rows = rows.filter((row) => Object.entries(criteria).every(
          ([column, expected]) => row[unqualify(column)] === expected,
        ));
        return builder;
      },
      andWhere(criteria: any, value?: unknown) {
        return builder.where(criteria, value);
      },
      select() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      async first() {
        return rows[0] ?? null;
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }) as any;
}

function clientRow(overrides: Row = {}): Row {
  return {
    tenant: TENANT,
    client_id: CLIENT_ID,
    client_name: 'Northstar Dental Group',
    billing_contact_id: null,
    billing_email: 'it-ops@northstardental.example',
    ...overrides,
  };
}

function profileRow(overrides: Row = {}): Row {
  return {
    tenant: TENANT,
    billing_profile_id: PROFILE_ID,
    client_id: CLIENT_ID,
    name: '12345',
    bill_to_name: null,
    billing_contact_id: null,
    billing_email: null,
    bill_to_location_id: null,
    ...overrides,
  };
}

const resolve = (knex: any, billingProfileId?: string | null) =>
  resolveInvoiceBillingRecipient({
    knexOrTrx: knex,
    tenantId: TENANT,
    clientId: CLIENT_ID,
    billingProfileId,
  });

describe('invoice billing recipient — the profile the invoice bills', () => {
  it('sends to the profile billing email instead of the parent client inbox', async () => {
    const knex = createMockKnex({
      clients: [clientRow()],
      client_billing_profiles: [profileRow({ billing_email: 'ap@12345.example' })],
      contacts: [],
      client_locations: [],
    });

    await expect(resolve(knex, PROFILE_ID)).resolves.toMatchObject({
      recipientEmail: 'ap@12345.example',
      recipientSource: 'profile_billing_email',
    });
  });

  it('prefers the profile billing contact over the client billing contact', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ billing_contact_id: 'contact-parent' })],
      client_billing_profiles: [profileRow({
        billing_contact_id: 'contact-site',
        bill_to_name: 'Northstar Dental — Munchkinland',
      })],
      contacts: [
        {
          tenant: TENANT,
          contact_name_id: 'contact-parent',
          client_id: CLIENT_ID,
          full_name: 'Parent AP',
          email: 'ap@northstardental.example',
          is_inactive: false,
        },
        {
          tenant: TENANT,
          contact_name_id: 'contact-site',
          client_id: CLIENT_ID,
          full_name: 'Site AP',
          email: 'ap@12345.example',
          is_inactive: false,
        },
      ],
      client_locations: [],
    });

    await expect(resolve(knex, PROFILE_ID)).resolves.toMatchObject({
      recipientEmail: 'ap@12345.example',
      recipientName: 'Site AP',
      recipientSource: 'profile_billing_contact',
    });
  });

  it('uses the bill-to location email when the profile names no contact or inbox', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ billing_email: null })],
      client_billing_profiles: [profileRow({ bill_to_location_id: 'loc-site' })],
      contacts: [],
      client_locations: [{
        tenant: TENANT,
        client_id: CLIENT_ID,
        location_id: 'loc-site',
        is_billing_address: false,
        is_default: false,
        is_active: true,
        email: 'site@12345.example',
      }],
    });

    await expect(resolve(knex, PROFILE_ID)).resolves.toMatchObject({
      recipientEmail: 'site@12345.example',
      recipientSource: 'profile_location',
    });
  });

  it('addresses the invoice by the profile bill-to name when it falls back to the client inbox', async () => {
    const knex = createMockKnex({
      clients: [clientRow()],
      client_billing_profiles: [profileRow({ bill_to_name: 'Northstar Dental — Munchkinland' })],
      contacts: [],
      client_locations: [],
    });

    await expect(resolve(knex, PROFILE_ID)).resolves.toMatchObject({
      recipientEmail: 'it-ops@northstardental.example',
      recipientName: 'Northstar Dental — Munchkinland',
      recipientSource: 'billing_email',
    });
  });

  it('inherits the client chain for a profile that fills nothing in', async () => {
    const knex = createMockKnex({
      clients: [clientRow()],
      client_billing_profiles: [profileRow()],
      contacts: [],
      client_locations: [],
    });

    await expect(resolve(knex, PROFILE_ID)).resolves.toMatchObject({
      recipientEmail: 'it-ops@northstardental.example',
      recipientName: 'Northstar Dental Group',
      recipientSource: 'billing_email',
    });
  });

  it('resolves an unsegmented invoice exactly as it did before profiles', async () => {
    const knex = createMockKnex({
      clients: [clientRow()],
      // A profile exists but this invoice carries none — nothing may change.
      client_billing_profiles: [profileRow({ billing_email: 'ap@12345.example' })],
      contacts: [],
      client_locations: [],
    });

    await expect(resolve(knex, null)).resolves.toMatchObject({
      recipientEmail: 'it-ops@northstardental.example',
      recipientSource: 'billing_email',
    });
  });

  it('ignores a profile that belongs to another client', async () => {
    const knex = createMockKnex({
      clients: [clientRow()],
      client_billing_profiles: [profileRow({
        client_id: 'client-elsewhere',
        billing_email: 'ap@elsewhere.example',
      })],
      contacts: [],
      client_locations: [],
    });

    await expect(resolve(knex, PROFILE_ID)).resolves.toMatchObject({
      recipientEmail: 'it-ops@northstardental.example',
      recipientSource: 'billing_email',
    });
  });

  it('does not read another tenant\'s profile', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ billing_email: null })],
      client_billing_profiles: [profileRow({ tenant: 'tenant-2', billing_email: 'ap@12345.example' })],
      contacts: [],
      client_locations: [],
    });

    await expect(resolve(knex, PROFILE_ID)).resolves.toMatchObject({
      recipientEmail: '',
      recipientSource: 'none',
    });
  });
});

describe('manual invoice billing-email gate asks about the profile it bills', () => {
  it('lets a profile with its own inbox through when the client has none', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ billing_email: null })],
      client_billing_profiles: [profileRow({ billing_email: 'ap@12345.example' })],
      contacts: [],
      client_locations: [],
    });

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID, PROFILE_ID))
      .resolves.toBe('ap@12345.example');
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Northstar Dental Group',
      PROFILE_ID,
    )).resolves.toEqual({ valid: true });
  });

  it('still blocks when neither the profile nor the client carries an address', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ billing_email: null })],
      client_billing_profiles: [profileRow()],
      contacts: [],
      client_locations: [],
    });

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID, PROFILE_ID)).resolves.toBeNull();
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Northstar Dental Group',
      PROFILE_ID,
    )).resolves.toMatchObject({ valid: false, code: 'NO_BILLING_EMAIL' });
  });
});
