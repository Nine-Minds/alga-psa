import { describe, expect, it } from 'vitest';

import {
  resolveClientExportEmail,
  resolveExportRecipientEmails,
} from '../../../../../packages/billing/src/adapters/accounting/exportRecipientEmails';

/**
 * An accounting export attaches the same address the invoice is emailed to:
 * the billed profile's own inbox for a separately-billing site, otherwise the
 * client's billing contact, billing email, or billing/default location — never
 * just the raw clients.billing_email column.
 */

const TENANT = 'tenant-1';
const CLIENT_ID = 'client-1';

type Row = Record<string, any>;

function unqualify(column: string) {
  const [, unqualified] = column.match(/^(?:[^.]+)\.(.+)$/) ?? [];
  return unqualified ?? column;
}

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

const tables = {
  clients: [{
    tenant: TENANT,
    client_id: CLIENT_ID,
    client_name: 'Northstar Dental Group',
    billing_contact_id: 'contact-ap',
    billing_email: 'stale-column@northstar.example',
  }],
  contacts: [{
    tenant: TENANT,
    contact_name_id: 'contact-ap',
    client_id: CLIENT_ID,
    full_name: 'Ada Okoro',
    email: 'ap@northstar.example',
    is_inactive: false,
  }],
  client_billing_profiles: [{
    tenant: TENANT,
    billing_profile_id: 'profile-site',
    client_id: CLIENT_ID,
    bill_to_name: 'Northstar Dental - Westside',
    billing_contact_id: null,
    billing_email: 'ap@westside.northstar.example',
    bill_to_location_id: null,
  }],
  client_locations: [],
};

describe('resolveExportRecipientEmails', () => {
  it('prefers the billing contact over the raw billing_email column for the client', async () => {
    const knex = createMockKnex(tables);

    await expect(resolveClientExportEmail(knex, TENANT, CLIENT_ID)).resolves.toBe('ap@northstar.example');
  });

  it('resolves a separately-billing profile to its own inbox, keyed by invoice', async () => {
    const knex = createMockKnex(tables);

    const emails = await resolveExportRecipientEmails(knex, TENANT, [
      { invoice_id: 'inv-parent', client_id: CLIENT_ID, billing_profile_id: null },
      { invoice_id: 'inv-site', client_id: CLIENT_ID, billing_profile_id: 'profile-site' },
      { invoice_id: 'inv-site-2', client_id: CLIENT_ID, billing_profile_id: 'profile-site' },
    ]);

    expect(emails.get('inv-parent')).toBe('ap@northstar.example');
    expect(emails.get('inv-site')).toBe('ap@westside.northstar.example');
    expect(emails.get('inv-site-2')).toBe('ap@westside.northstar.example');
  });

  it('yields null rather than a blank for a client with no address at all', async () => {
    const knex = createMockKnex({
      ...tables,
      clients: [{ ...tables.clients[0], billing_contact_id: null, billing_email: null }],
    });

    const emails = await resolveExportRecipientEmails(knex, TENANT, [
      { invoice_id: 'inv-1', client_id: CLIENT_ID },
    ]);

    expect(emails.get('inv-1')).toBeNull();
  });
});
