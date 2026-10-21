/**
 * Compile-only SQL-shape test (no DB): the REST invoice read path
 * (GET /api/v1/invoices and /{id}, both via buildBaseQuery) must join its two
 * derived tables on `tenant` as well as `invoice_id`, so Citus can push the
 * join down to one shard instead of opening an extra connection. It also pins
 * balance_due to total - credit - net payments (computeBalanceDue).
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
  it('selects and groups the recurring summary by tenant and invoice_id', () => {
    const sql = compile();
    expect(sql).toContain('"rsp"."tenant"');
    expect(sql).toContain('group by "rsp"."tenant", "rsp"."invoice_id"');
  });

  it('selects and groups the payments summary by tenant and invoice_id', () => {
    const sql = compile();
    expect(sql).toContain('sum("ip"."amount") as "total_paid"');
    expect(sql).toContain('group by "ip"."tenant", "ip"."invoice_id"');
  });

  it('joins both derived tables on tenant as well as invoice_id', () => {
    const sql = compile();
    expect(sql).toContain('"recurring_invoice_summary"."invoice_id" = "invoices"."invoice_id"');
    expect(sql).toContain('"recurring_invoice_summary"."tenant" = "invoices"."tenant"');
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
});
