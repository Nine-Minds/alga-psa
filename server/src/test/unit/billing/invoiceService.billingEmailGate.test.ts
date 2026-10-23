import { describe, expect, it } from 'vitest';

import {
  getClientBillingEmail,
  validateClientBillingEmail,
} from '../../../../../packages/billing/src/services/invoiceService';

/**
 * The billing-email check is advisory: it tells preview and the manual form
 * whether the invoice could be emailed or paid online. It never blocks
 * generation — sending and payment-link creation refuse on their own — and it
 * stays quiet for a client (or profile) that is mailed and pays offline.
 */

const TENANT = 'tenant-1';
const CLIENT_ID = 'client-1';
const PROFILE_ID = 'profile-default';

type Row = Record<string, any>;

function unqualify(column: string) {
  const [, unqualified] = column.match(/^(?:[^.]+)\.(.+)$/) ?? [];
  return unqualified ?? column;
}

/**
 * Minimal knex stand-in: enough of the builder surface for
 * resolveInvoiceBillingRecipient and resolveEffectiveBillingIdentity (equality
 * where, callback where with orWhereNull, select, orderBy, first, and awaiting
 * the builder for a row list).
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
    client_name: 'Omni Energy Partners',
    billing_contact_id: null,
    billing_email: null,
    invoice_delivery_method: 'email',
    preferred_payment_method: 'credit_card',
    payment_terms: 'net_30',
    ...overrides,
  };
}

function profileRow(overrides: Row = {}): Row {
  return {
    tenant: TENANT,
    billing_profile_id: PROFILE_ID,
    client_id: CLIENT_ID,
    name: 'Omni Energy Partners',
    is_default: true,
    bills_separately: false,
    bill_to_name: null,
    bill_to_location_id: null,
    billing_contact_id: null,
    billing_email: null,
    invoice_delivery_method: null,
    preferred_payment_method: null,
    payment_terms: null,
    ...overrides,
  };
}

function tables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    clients: [clientRow()],
    client_billing_profiles: [profileRow()],
    contacts: [],
    client_locations: [],
    ...overrides,
  };
}

describe('invoice billing-email check', () => {
  it('accepts a client whose only recipient is an active billing contact', async () => {
    const knex = createMockKnex(tables({
      clients: [clientRow({ billing_contact_id: 'contact-1' })],
      contacts: [{
        tenant: TENANT,
        contact_name_id: 'contact-1',
        client_id: CLIENT_ID,
        full_name: 'Ada Okoro',
        email: 'ada@omni.test',
        is_inactive: false,
      }],
    }));

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBe('ada@omni.test');
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
    )).resolves.toEqual({ valid: true });
  });

  it('accepts a client whose only recipient is clients.billing_email', async () => {
    const knex = createMockKnex(tables({
      clients: [clientRow({ billing_email: 'ap@omni.test' })],
    }));

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBe('ap@omni.test');
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
    )).resolves.toEqual({ valid: true });
  });

  it('accepts a profile whose AP inbox lives on the profile alone', async () => {
    const knex = createMockKnex(tables({
      client_billing_profiles: [
        profileRow(),
        profileRow({ billing_profile_id: 'profile-site', is_default: false, billing_email: 'ap@site.omni.test' }),
      ],
    }));

    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
      'profile-site',
    )).resolves.toEqual({ valid: true });
    // The client itself still has nowhere to send an invoice.
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
    )).resolves.toMatchObject({ valid: false, code: 'NO_BILLING_EMAIL' });
  });

  it('skips an inactive billing contact and falls through to the billing location', async () => {
    const knex = createMockKnex(tables({
      clients: [clientRow({ billing_contact_id: 'contact-1' })],
      contacts: [{
        tenant: TENANT,
        contact_name_id: 'contact-1',
        client_id: CLIENT_ID,
        full_name: 'Ada Okoro',
        email: 'ada@omni.test',
        is_inactive: true,
      }],
      client_locations: [{
        tenant: TENANT,
        client_id: CLIENT_ID,
        location_id: 'loc-1',
        is_billing_address: true,
        is_default: false,
        is_active: true,
        email: 'billing@omni.test',
      }],
    }));

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBe('billing@omni.test');
  });

  it('ignores an inactive location and reports NO_BILLING_EMAIL', async () => {
    const knex = createMockKnex(tables({
      client_locations: [{
        tenant: TENANT,
        client_id: CLIENT_ID,
        location_id: 'loc-1',
        is_billing_address: true,
        is_default: true,
        is_active: false,
        email: 'stale@omni.test',
      }],
    }));

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBeNull();

    const result = await validateClientBillingEmail(knex, TENANT, CLIENT_ID, 'Omni Energy Partners');
    expect(result).toMatchObject({
      valid: false,
      code: 'NO_BILLING_EMAIL',
      params: { clientName: 'Omni Energy Partners' },
    });
    // The REST layer maps this failure to a 409 by matching this exact prefix
    // (server/src/lib/api/services/InvoiceService.ts). Changing it silently
    // demotes the response to a 500.
    expect(result.error).toMatch(/^Cannot generate invoice: No billing email address for "Omni Energy Partners"\. /);
    expect(result.error).toContain('billing contact');
  });

  it('stays quiet for a client that is mailed and pays offline', async () => {
    const knex = createMockKnex(tables({
      clients: [clientRow({ invoice_delivery_method: 'mail', preferred_payment_method: 'check' })],
    }));

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBeNull();
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
    )).resolves.toEqual({ valid: true });
  });

  it('reads delivery and payment method through the billed profile', async () => {
    const knex = createMockKnex(tables({
      clients: [clientRow({ invoice_delivery_method: 'mail', preferred_payment_method: 'check' })],
      client_billing_profiles: [
        profileRow(),
        // The site is paid by card, so a mailed-only client setting does not excuse it.
        profileRow({ billing_profile_id: 'profile-site', is_default: false, preferred_payment_method: 'credit_card' }),
      ],
    }));

    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
      'profile-site',
    )).resolves.toMatchObject({ valid: false, code: 'NO_BILLING_EMAIL' });
  });

  it('still flags a mailed client that pays by card', async () => {
    const knex = createMockKnex(tables({
      clients: [clientRow({ invoice_delivery_method: 'mail', preferred_payment_method: 'credit_card' })],
    }));

    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
    )).resolves.toMatchObject({ valid: false, code: 'NO_BILLING_EMAIL' });
  });

  it('does not read another tenant\'s client', async () => {
    const knex = createMockKnex(tables({
      clients: [clientRow({ tenant: 'tenant-2', billing_email: 'ap@omni.test' })],
    }));

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBeNull();
  });
});
