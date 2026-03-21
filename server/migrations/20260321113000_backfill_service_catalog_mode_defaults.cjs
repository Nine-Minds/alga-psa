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

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const normalizeBillingMode = knex.raw(
    "CASE sc.billing_method WHEN 'per_unit' THEN 'usage' ELSE sc.billing_method END"
  );

  const invalidModeRows = await knex('service_catalog as sc')
    .where('sc.item_kind', 'service')
    .andWhere('sc.is_active', true)
    .whereNotIn(normalizeBillingMode, ALLOWED_BILLING_MODES)
    .select('sc.service_id', 'sc.billing_method')
    .limit(25);

  if (invalidModeRows.length > 0) {
    throw new Error(
      `Cannot backfill service_catalog_mode_defaults; encountered unmappable billing_method values: ${JSON.stringify(invalidModeRows)}`
    );
  }

  await knex.raw(`
    INSERT INTO service_catalog_mode_defaults (tenant, service_id, billing_mode, currency_code, rate)
    SELECT
      sp.tenant,
      sp.service_id,
      CASE sc.billing_method WHEN 'per_unit' THEN 'usage' ELSE sc.billing_method END AS billing_mode,
      sp.currency_code,
      sp.rate
    FROM service_prices sp
    INNER JOIN service_catalog sc
      ON sc.tenant = sp.tenant
     AND sc.service_id = sp.service_id
    WHERE sc.item_kind = 'service'
      AND sc.is_active = true
      AND sp.rate >= 0
      AND CASE sc.billing_method WHEN 'per_unit' THEN 'usage' ELSE sc.billing_method END IN ('fixed', 'hourly', 'usage')
    ON CONFLICT (tenant, service_id, billing_mode, currency_code) DO NOTHING
  `);

  await knex.raw(`
    INSERT INTO service_catalog_mode_defaults (tenant, service_id, billing_mode, currency_code, rate)
    SELECT
      sc.tenant,
      sc.service_id,
      CASE sc.billing_method WHEN 'per_unit' THEN 'usage' ELSE sc.billing_method END AS billing_mode,
      COALESCE(sc.currency_code, 'USD') AS currency_code,
      sc.default_rate AS rate
    FROM service_catalog sc
    WHERE sc.item_kind = 'service'
      AND sc.is_active = true
      AND sc.default_rate IS NOT NULL
      AND sc.default_rate >= 0
      AND CASE sc.billing_method WHEN 'per_unit' THEN 'usage' ELSE sc.billing_method END IN ('fixed', 'hourly', 'usage')
      AND NOT EXISTS (
        SELECT 1
        FROM service_prices sp
        WHERE sp.tenant = sc.tenant
          AND sp.service_id = sc.service_id
      )
    ON CONFLICT (tenant, service_id, billing_mode, currency_code) DO NOTHING
  `);

  const missingRows = await knex
    .select('sc.tenant', 'sc.service_id')
    .from('service_catalog as sc')
    .where('sc.item_kind', 'service')
    .andWhere('sc.is_active', true)
    .andWhere(function requiredSourceDefaults() {
      this.whereExists(
        knex('service_prices as sp')
          .select(knex.raw('1'))
          .whereRaw('sp.tenant = sc.tenant')
          .andWhereRaw('sp.service_id = sc.service_id')
      ).orWhereNotNull('sc.default_rate');
    })
    .andWhereNotExists(
      knex('service_catalog_mode_defaults as md')
        .select(knex.raw('1'))
        .whereRaw('md.tenant = sc.tenant')
        .andWhereRaw('md.service_id = sc.service_id')
        .andWhereRaw(
          "md.billing_mode = CASE sc.billing_method WHEN 'per_unit' THEN 'usage' ELSE sc.billing_method END"
        )
    )
    .limit(25);

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
