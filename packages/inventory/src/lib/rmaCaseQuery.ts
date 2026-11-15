import type { Knex } from 'knex';

/**
 * The one joined SELECT that defines the `IRmaCase` row shape (case columns plus
 * client/vendor/service names, returned-unit details and `age_days`). Lives in lib/
 * rather than the 'use server' actions file because it is synchronous.
 * Callers add their own filters/ordering; the tenant filter is applied here.
 */
export function rmaCaseQuery(trx: Knex.Transaction, tenant: string): Knex.QueryBuilder {
  return trx('rma_cases as r')
    .leftJoin('clients as c', function () {
      this.on('r.client_id', '=', 'c.client_id').andOn('r.tenant', '=', 'c.tenant');
    })
    .leftJoin('vendors as v', function () {
      this.on('r.vendor_id', '=', 'v.vendor_id').andOn('r.tenant', '=', 'v.tenant');
    })
    .leftJoin('service_catalog as sc', function () {
      this.on('r.service_id', '=', 'sc.service_id').andOn('r.tenant', '=', 'sc.tenant');
    })
    .leftJoin('stock_units as su', function () {
      this.on('r.returned_unit_id', '=', 'su.unit_id').andOn('r.tenant', '=', 'su.tenant');
    })
    .leftJoin('assets as a', function () {
      this.on('r.asset_id', '=', 'a.asset_id').andOn('r.tenant', '=', 'a.tenant');
    })
    .leftJoin('tickets as tk', function () {
      this.on('r.ticket_id', '=', 'tk.ticket_id').andOn('r.tenant', '=', 'tk.tenant');
    })
    .where({ 'r.tenant': tenant })
    .select(
      'r.*',
      // DATE columns come back from pg as JS Dates and would shift a day when serialised; send the calendar date.
      trx.raw(`to_char(r.return_by, 'YYYY-MM-DD') as return_by`),
      'c.client_name',
      'a.name as asset_name',
      'a.asset_tag',
      'a.serial_number as asset_serial_number',
      'tk.ticket_number',
      'v.vendor_name',
      'sc.service_name',
      'sc.sku as service_sku',
      'su.serial_number as returned_serial_number',
      'su.mac_address as returned_mac_address',
      'su.unit_cost as returned_unit_cost',
      'su.cost_currency as returned_unit_cost_currency',
      trx.raw(`CASE
        WHEN r.status = 'sent_to_vendor' THEN GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(r.updated_at, r.opened_at, now()))) / 86400)
        )::int
        ELSE NULL
      END as age_days`),
    );
}
