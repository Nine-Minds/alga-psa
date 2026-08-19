import { describe, expect, it } from 'vitest';

import {
  getClientBillingEmail,
  validateClientBillingEmail,
} from '../../../../../packages/billing/src/services/invoiceService';

const TENANT = 'tenant-1';
const CLIENT_ID = 'client-1';

type Row = Record<string, any>;

function unqualify(column: string) {
  const [, unqualified] = column.match(/^(?:[^.]+)\.(.+)$/) ?? [];
  return unqualified ?? column;
}

/**
 * Minimal knex stand-in: enough of the builder surface for
 * resolveInvoiceBillingRecipient (equality where, callback where with orWhereNull,
 * select, orderBy, first, and awaiting the builder for a row list).
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
    ...overrides,
  };
}

describe('manual invoice billing-email gate', () => {
  it('accepts a client whose only recipient is an active billing contact', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ billing_contact_id: 'contact-1' })],
      contacts: [{
        tenant: TENANT,
        contact_name_id: 'contact-1',
        client_id: CLIENT_ID,
        full_name: 'Ada Okoro',
        email: 'ada@omni.test',
        is_inactive: false,
      }],
      client_locations: [],
    });

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBe('ada@omni.test');
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
    )).resolves.toEqual({ valid: true });
  });

  it('accepts a client whose only recipient is clients.billing_email', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ billing_email: 'ap@omni.test' })],
      contacts: [],
      client_locations: [],
    });

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBe('ap@omni.test');
    await expect(validateClientBillingEmail(
      knex,
      TENANT,
      CLIENT_ID,
      'Omni Energy Partners',
    )).resolves.toEqual({ valid: true });
  });

  it('skips an inactive billing contact and falls through to the billing location', async () => {
    const knex = createMockKnex({
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
    });

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBe('billing@omni.test');
  });

  it('ignores an inactive location and blocks with NO_BILLING_EMAIL', async () => {
    const knex = createMockKnex({
      clients: [clientRow()],
      contacts: [],
      client_locations: [{
        tenant: TENANT,
        client_id: CLIENT_ID,
        location_id: 'loc-1',
        is_billing_address: true,
        is_default: true,
        is_active: false,
        email: 'stale@omni.test',
      }],
    });

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

  it('does not read another tenant\'s client', async () => {
    const knex = createMockKnex({
      clients: [clientRow({ tenant: 'tenant-2', billing_email: 'ap@omni.test' })],
      contacts: [],
      client_locations: [],
    });

    await expect(getClientBillingEmail(knex, TENANT, CLIENT_ID)).resolves.toBeNull();
  });
});
