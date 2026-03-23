/**
 * Backfill service catalog mode defaults from existing catalog pricing data.
 *
 * One-way migration:
 * - Maps legacy per_unit -> usage
 * - Seeds from service_prices when present
 * - Falls back to service_catalog default_rate/currency_code when service_prices are absent
 * - Fails fast if active service rows cannot be mapped deterministically
 */

const ALLOWED_BILLING_MODES = ['fixed', 'hourly', 'usage'];

const normalizeBillingMode = (billingMethod) =>
  billingMethod === 'per_unit' ? 'usage' : billingMethod;

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasServiceCatalogCurrencyCode = await knex.schema.hasColumn('service_catalog', 'currency_code');
  const activeServices = await knex('service_catalog as sc')
    .where('sc.item_kind', 'service')
    .andWhere('sc.is_active', true)
    .select([
      'sc.tenant',
      'sc.service_id',
      'sc.billing_method',
      'sc.default_rate',
      ...(hasServiceCatalogCurrencyCode ? ['sc.currency_code'] : []),
    ]);

  const invalidModeRows = activeServices
    .filter((row) => !ALLOWED_BILLING_MODES.includes(normalizeBillingMode(row.billing_method)))
    .slice(0, 25)
    .map((row) => ({
      service_id: row.service_id,
      billing_method: row.billing_method,
    }));

  if (invalidModeRows.length > 0) {
    throw new Error(
      `Cannot backfill service_catalog_mode_defaults; encountered unmappable billing_method values: ${JSON.stringify(invalidModeRows)}`
    );
  }

  const servicePrices = await knex('service_prices')
    .select('tenant', 'service_id', 'currency_code', 'rate');

  const servicesByKey = new Map(
    activeServices.map((row) => [`${row.tenant}:${row.service_id}`, row])
  );

  const servicePricesByKey = new Map();
  for (const priceRow of servicePrices) {
    const key = `${priceRow.tenant}:${priceRow.service_id}`;
    const current = servicePricesByKey.get(key) ?? [];
    current.push(priceRow);
    servicePricesByKey.set(key, current);
  }

  const rowsToInsert = [];

  for (const serviceRow of activeServices) {
    const billingMode = normalizeBillingMode(serviceRow.billing_method);
    if (!ALLOWED_BILLING_MODES.includes(billingMode)) {
      continue;
    }

    const key = `${serviceRow.tenant}:${serviceRow.service_id}`;
    const pricesForService = servicePricesByKey.get(key) ?? [];

    if (pricesForService.length > 0) {
      for (const priceRow of pricesForService) {
        if (priceRow.rate == null || Number(priceRow.rate) < 0) {
          continue;
        }
        rowsToInsert.push({
          tenant: priceRow.tenant,
          service_id: priceRow.service_id,
          billing_mode: billingMode,
          currency_code: priceRow.currency_code,
          rate: priceRow.rate,
        });
      }
      continue;
    }

    if (serviceRow.default_rate != null && Number(serviceRow.default_rate) >= 0) {
      rowsToInsert.push({
        tenant: serviceRow.tenant,
        service_id: serviceRow.service_id,
        billing_mode: billingMode,
        currency_code: hasServiceCatalogCurrencyCode ? (serviceRow.currency_code ?? 'USD') : 'USD',
        rate: serviceRow.default_rate,
      });
    }
  }

  for (const rows of chunk(rowsToInsert, 500)) {
    await knex('service_catalog_mode_defaults')
      .insert(rows)
      .onConflict(['tenant', 'service_id', 'billing_mode', 'currency_code'])
      .ignore();
  }

  const insertedDefaults = await knex('service_catalog_mode_defaults')
    .select('tenant', 'service_id', 'billing_mode');

  const insertedKeys = new Set(
    insertedDefaults.map((row) => `${row.tenant}:${row.service_id}:${row.billing_mode}`)
  );

  const missingRows = activeServices
    .filter((serviceRow) => {
      const billingMode = normalizeBillingMode(serviceRow.billing_method);
      if (!ALLOWED_BILLING_MODES.includes(billingMode)) {
        return false;
      }

      const key = `${serviceRow.tenant}:${serviceRow.service_id}`;
      const hasServicePrices = (servicePricesByKey.get(key) ?? []).length > 0;
      const hasCatalogFallback = serviceRow.default_rate != null;

      if (!hasServicePrices && !hasCatalogFallback) {
        return false;
      }

      return !insertedKeys.has(`${serviceRow.tenant}:${serviceRow.service_id}:${billingMode}`);
    })
    .slice(0, 25)
    .map((row) => ({
      tenant: row.tenant,
      service_id: row.service_id,
    }));

  if (missingRows.length > 0) {
    throw new Error(
      `Backfill failed; required mode-default mappings are missing for active services: ${JSON.stringify(missingRows)}`
    );
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex('service_catalog_mode_defaults').del();
};
