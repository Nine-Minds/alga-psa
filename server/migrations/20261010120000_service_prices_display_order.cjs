'use strict';

/**
 * service_prices.display_order (alga0002016).
 *
 * `prices[0]` is the primary price and drives `default_rate`, and the Service
 * Catalog displays it. Until now "first" was whatever order Postgres returned
 * the rows in. `display_order` makes the primary explicit.
 *
 * Backfill, per (tenant, service, window) where a window is the current rows
 * (effective_date <= today) or the rows of one future effective_date:
 *   1. the row whose rate equals service_catalog.default_rate gets 0;
 *   2. otherwise the tenant default-currency row gets 0;
 *   3. every remaining row is numbered by currency_code, starting at 1.
 * Rows of the same currency inside the current window (older, superseded dated
 * rows) share the order of the row that is actually current for that currency.
 *
 * Citus: `service_prices` is distributed by tenant. ADD COLUMN ... DEFAULT is
 * supported, and every statement below is filtered by tenant, so each runs on
 * a single shard. Access goes through tenantDb.cjs.
 */

const { tenantDb } = require('./utils/tenantDb.cjs');

const TABLE = 'service_prices';
const COLUMN = 'display_order';
const MIGRATION_TENANT = 'migration:20261010120000_service_prices_display_order';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for service_prices display_order backfill';

const calendarDate = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '1970-01-01').slice(0, 10);
};

/**
 * Pure backfill rule so it can be unit tested on fixtures.
 *
 * @param {Array<{price_id:string, service_id:string, currency_code:string, rate:number|string, effective_date:any}>} priceRows
 * @param {Map<string, number>|Record<string, number>} defaultRateByService
 * @param {string|null} tenantDefaultCurrency
 * @param {string} today YYYY-MM-DD
 * @returns {Map<string, number>} price_id -> display_order
 */
function computeDisplayOrders(priceRows, defaultRateByService, tenantDefaultCurrency, today) {
  const defaultRateOf = (serviceId) => {
    const value = defaultRateByService instanceof Map
      ? defaultRateByService.get(serviceId)
      : defaultRateByService[serviceId];
    return value === undefined || value === null ? null : Number(value);
  };

  // window key -> currency -> representative row (+ every row of that currency)
  const windows = new Map();
  for (const row of priceRows) {
    const effective = calendarDate(row.effective_date);
    const windowKey = `${row.service_id}|${effective <= today ? 'current' : effective}`;
    if (!windows.has(windowKey)) windows.set(windowKey, { serviceId: row.service_id, currencies: new Map() });
    const currencies = windows.get(windowKey).currencies;
    const entry = currencies.get(row.currency_code) ?? { representative: row, rows: [] };
    if (calendarDate(row.effective_date) >= calendarDate(entry.representative.effective_date)) {
      entry.representative = row;
    }
    entry.rows.push(row);
    currencies.set(row.currency_code, entry);
  }

  const result = new Map();
  for (const { serviceId, currencies } of windows.values()) {
    const codes = [...currencies.keys()].sort();
    const defaultRate = defaultRateOf(serviceId);
    let primary = defaultRate === null
      ? undefined
      : codes.find((code) => Number(currencies.get(code).representative.rate) === defaultRate);
    if (primary === undefined && tenantDefaultCurrency && currencies.has(tenantDefaultCurrency)) {
      primary = tenantDefaultCurrency;
    }
    let next = 1;
    for (const code of codes) {
      const order = code === primary ? 0 : next++;
      for (const row of currencies.get(code).rows) result.set(row.price_id, order);
    }
  }
  return result;
}

exports.computeDisplayOrders = computeDisplayOrders;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex.schema.hasColumn(TABLE, COLUMN)) {
    // Already applied (retry / partial run): do not re-run the backfill over
    // orders that the application may have written since.
    return;
  }

  await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} smallint NOT NULL DEFAULT 0`);

  const today = new Date().toISOString().slice(0, 10);
  const tenants = await tenantDb(knex, MIGRATION_TENANT)
    .unscoped('tenants', TENANT_ENUMERATION_REASON)
    .select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const priceRows = await db.table(TABLE).select('price_id', 'service_id', 'currency_code', 'rate', 'effective_date');
    if (priceRows.length === 0) continue;

    const services = await db.table('service_catalog')
      .whereIn('service_id', [...new Set(priceRows.map((row) => row.service_id))])
      .select('service_id', 'default_rate');
    const defaultRates = new Map(services.map((service) => [service.service_id, service.default_rate]));
    const settings = await db.table('default_billing_settings').first('default_currency_code');

    const orders = computeDisplayOrders(priceRows, defaultRates, settings?.default_currency_code ?? null, today);

    // Group by order value so the number of UPDATEs is bounded by the number of
    // currencies, not rows.
    const idsByOrder = new Map();
    for (const [priceId, order] of orders) {
      if (order === 0) continue; // column default
      if (!idsByOrder.has(order)) idsByOrder.set(order, []);
      idsByOrder.get(order).push(priceId);
    }
    for (const [order, ids] of idsByOrder) {
      for (let i = 0; i < ids.length; i += 1000) {
        await db.table(TABLE)
          .whereIn('price_id', ids.slice(i, i + 1000))
          .update({ [COLUMN]: order });
      }
    }
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex.schema.hasColumn(TABLE, COLUMN)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
  }
};
