/**
 * Compile-only SQL-shape test (no DB) for the REST invoice read path
 * (GET /api/v1/invoices and /{id}).
 *
 * HARD RULE: no statement on that path may reference recurring_service_periods
 * together with `invoices` (or any other distributed table); rsp is not
 * distributed, so such a statement makes the Citus coordinator connect back to
 * itself, which fails when connection slots are exhausted. Recurring fields are
 * read in standalone tenant-scoped rsp queries and merged in JS.
 *
 * Also: the payments summary still joins on `tenant` as well as `invoice_id`,
 * and balance_due stays total - credit - net payments (computeBalanceDue).
 */
import { describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { InvoiceService } from '../../../lib/api/services/InvoiceService';

const TENANT = '11111111-1111-1111-1111-111111111111';

function compile(): string {
  const knex = knexFactory({ client: 'pg' });
  const service = new InvoiceService() as any;
  return service.buildBaseQuery(knex, { tenant: TENANT }).toSQL().sql as string;
}

describe('InvoiceService.buildBaseQuery SQL shape', () => {
  it('does not reference recurring_service_periods at all', () => {
    const sql = compile();
    expect(sql).not.toContain('recurring_service_periods');
    expect(sql).not.toContain('recurring_invoice_summary');
  });

  it('selects and groups the payments summary by tenant and invoice_id', () => {
    const sql = compile();
    expect(sql).toContain('sum("ip"."amount") as "total_paid"');
    expect(sql).toContain('group by "ip"."tenant", "ip"."invoice_id"');
  });

  it('joins the payments summary on tenant as well as invoice_id', () => {
    const sql = compile();
    expect(sql).toContain('"invoice_payments_summary"."invoice_id" = "invoices"."invoice_id"');
    expect(sql).toContain('"invoice_payments_summary"."tenant" = "invoices"."tenant"');
  });

  it('computes balance_due as total - credit - payments', () => {
    const sql = compile();
    expect(sql).toContain(
      '(invoices.total_amount - COALESCE(invoices.credit_applied, 0) - COALESCE(invoice_payments_summary.total_paid, 0)) as balance_due',
    );
  });
});

describe('InvoiceService.joinClientBillingAddress SQL shape (include_client)', () => {
  it('joins the billing address derived table on tenant as well as client_id', () => {
    const knex = knexFactory({ client: 'pg' });
    const service = new InvoiceService() as any;
    const base = service.buildBaseQuery(knex, { tenant: TENANT });
    const sql = service.joinClientBillingAddress(knex, { tenant: TENANT }, base).toSQL().sql as string;
    expect(sql).toContain('"clients"."client_id" = "billing_loc"."client_id"');
    expect(sql).toContain('"billing_loc"."tenant" = "clients"."tenant"');
  });

  it('picks one location per client (DISTINCT ON tenant, client_id) with no global limit', () => {
    const knex = knexFactory({ client: 'pg' });
    const service = new InvoiceService() as any;
    const base = service.buildBaseQuery(knex, { tenant: TENANT });
    const sql = service.joinClientBillingAddress(knex, { tenant: TENANT }, base).toSQL().sql as string;
    expect(sql).toContain('DISTINCT ON (cl.tenant, cl.client_id)');
    expect(sql).toContain('order by cl.tenant, cl.client_id, cl.is_billing_address DESC');
    expect(sql).not.toMatch(/limit \?[^)]*\) as "billing_loc"/);
  });
});

/**
 * Runs the real InvoiceService.list/getById/getStatistics against a knex whose
 * driver is stubbed out, capturing every statement actually issued.
 */
async function captureStatements(
  run: (service: any, context: any) => Promise<unknown>,
): Promise<string[]> {
  const statements: string[] = [];
  const knex: any = knexFactory({ client: 'pg' });
  knex.client.acquireConnection = async () => ({});
  knex.client.releaseConnection = async () => undefined;
  knex.client._query = async (_conn: unknown, obj: any) => {
    statements.push(obj.sql as string);
    const sql = obj.sql as string;
    let rows: any[] = [];
    if (sql.includes('having max(rsp.cadence_owner)')) rows = [{ invoice_id: 'inv-1' }];
    else if (/count\(/i.test(sql)) rows = [{ count: '1' }];
    else if (sql.includes('from "invoices"')) rows = [{ invoice_id: 'inv-1', client_id: 'c-1' }];
    obj.response = { rows, rowCount: rows.length, command: 'SELECT' };
    return obj;
  };
  // Make the fake knex look like an open transaction so withTransaction reuses it.
  knex.commit = async () => undefined;
  knex.rollback = async () => undefined;

  const service: any = new InvoiceService();
  service.validatePermissions = async () => undefined;
  service.getKnex = async () => ({ knex, tenant: TENANT });
  // Detail side-reads are not part of the invoice/rsp statement under test.
  service.getInvoiceLineItems = async () => [];
  service.getInvoiceClient = async () => null;
  service.getBillingCycle = async () => null;
  service.getTaxDetails = async () => null;
  await run(service, { tenant: TENANT, userId: 'user-1' });
  return statements;
}

const CADENCE_FILTERS: Array<Record<string, string>> = [
  { execution_window_kind: 'contract_cadence_window' },
  { execution_window_kind: 'client_cadence_window' },
  { cadence_source: 'contract_anniversary' },
  { cadence_source: 'client_schedule' },
];

describe('REST invoice read path: no statement joins recurring_service_periods with invoices', () => {
  const scenarios: Array<[string, (s: any, c: any) => Promise<unknown>]> = [
    ['list', (s, c) => s.list({ page: 1, limit: 10 }, c)],
    ['list include_client', (s, c) => s.list({ page: 1, limit: 10, include_client: true }, c)],
    ['list include_billing_cycle', (s, c) => s.list({ page: 1, limit: 10, include_billing_cycle: true }, c)],
    ['detail', (s, c) => s.getById('inv-1', c, { include_items: false, include_client: false })],
    ...CADENCE_FILTERS.map(
      (f): [string, (s: any, c: any) => Promise<unknown>] => [
        `list ${JSON.stringify(f)}`,
        (s, c) => s.list({ page: 1, limit: 10, include_client: true }, c, f),
      ],
    ),
    ...CADENCE_FILTERS.map(
      (f): [string, (s: any, c: any) => Promise<unknown>] => [
        `statistics ${JSON.stringify(f)}`,
        (s, c) => s.getStatistics(c, f),
      ],
    ),
  ];

  it.each(scenarios)('%s', async (_name, run) => {
    const statements = await captureStatements(run);
    expect(statements.length).toBeGreaterThan(0);

    for (const sql of statements) {
      const mentionsRsp = sql.includes('recurring_service_periods');
      // The rule is about relations: the substring "invoices" must not appear next to rsp.
      expect(mentionsRsp && /\binvoices\b/.test(sql.replace(/"?invoice_id"?/g, ''))).toBe(false);
      if (mentionsRsp) {
        // Standalone, tenant-scoped rsp statement.
        expect(sql).toMatch(/"rsp"\."tenant" = \$\d+/);
        expect(sql).not.toMatch(/\bjoin\b/i);
        expect(sql).toContain('"rsp"."invoice_id" is not null');
      }
    }
  });

  it('list issues one standalone merge query for the page and none when the page is empty', async () => {
    const statements = await captureStatements((s, c) => s.list({ page: 1, limit: 10 }, c));
    const rsp = statements.filter((sql) => sql.includes('recurring_service_periods'));
    expect(rsp).toHaveLength(1);
    expect(rsp[0]).toContain('"rsp"."invoice_id" in ($');
    expect(rsp[0]).toContain('group by "rsp"."tenant", "rsp"."invoice_id"');
  });

  it('cadence filter adds a third statement and applies the resolved ids to data and count queries', async () => {
    const statements = await captureStatements((s, c) =>
      s.list({ page: 1, limit: 10 }, c, { cadence_source: 'client_schedule' }),
    );
    const resolve = statements.filter((sql) => sql.includes('having max(rsp.cadence_owner)'));
    expect(resolve).toHaveLength(1);
    expect(resolve[0]).toContain('group by "rsp"."tenant", "rsp"."invoice_id"');
    const invoiceQueries = statements.filter((sql) => sql.includes('from "invoices"'));
    expect(invoiceQueries).toHaveLength(2); // data + count
    for (const sql of invoiceQueries) {
      expect(sql).toContain('"invoices"."invoice_id" in ($');
    }
  });

  it('an empty resolved id list yields an empty page without querying invoices', async () => {
    const knexStatements: string[] = [];
    const knex: any = knexFactory({ client: 'pg' });
    knex.client.acquireConnection = async () => ({});
    knex.client.releaseConnection = async () => undefined;
    knex.client._query = async (_c: unknown, obj: any) => {
      knexStatements.push(obj.sql);
      obj.response = { rows: [], rowCount: 0, command: 'SELECT' };
      return obj;
    };
    knex.commit = async () => undefined;
    knex.rollback = async () => undefined;
    const service: any = new InvoiceService();
    service.validatePermissions = async () => undefined;
    service.getKnex = async () => ({ knex, tenant: TENANT });
    const result = await service.list({ page: 1, limit: 10 }, { tenant: TENANT, userId: 'u' }, { cadence_source: 'client_schedule' });
    expect(result).toEqual({ data: [], total: 0 });
    expect(knexStatements).toHaveLength(1);
    expect(knexStatements.join('\n')).not.toMatch(/\bin \(\)/);
  });

  it('unrecognised cadence filter values are no-ops (no rsp query, no id predicate)', async () => {
    const statements = await captureStatements((s, c) =>
      s.list({ page: 1, limit: 10 }, c, { cadence_source: 'bogus', execution_window_kind: 'bogus' }),
    );
    expect(statements.some((sql) => sql.includes('having'))).toBe(false);
    for (const sql of statements.filter((q) => q.includes('from "invoices"'))) {
      expect(sql).not.toContain('"invoices"."invoice_id" in');
    }
  });
});
