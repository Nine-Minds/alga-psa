/**
 * Asset record fields (FR-A1 / FR-A2).
 *
 * Manufacturer, model, vendor, purchase cost and order number become
 * first-class `assets` columns instead of `attributes` jsonb keys and RMM
 * `system_info` lookups. The data migration moves what is already stored:
 * `attributes.manufacturer` / `attributes.model` into the columns (dropping the
 * keys), then fills still-empty values from the workstation/server extension
 * `system_info` blocks.
 *
 * Purchase cost follows the money convention: bigint minor units plus an
 * explicit currency (see 20260626100100_create_inventory_stock.cjs).
 */

exports.up = async function up(knex) {
  const hasManufacturer = await knex.schema.hasColumn('assets', 'manufacturer');
  if (!hasManufacturer) {
    await knex.schema.alterTable('assets', (table) => {
      table.text('manufacturer').nullable();
      table.text('model').nullable();
      table.uuid('vendor_id').nullable();
      table.bigInteger('purchase_cost').nullable();
      table.text('purchase_cost_currency').nullable();
      table.text('order_number').nullable();
      table.foreign(['tenant', 'vendor_id']).references(['tenant', 'vendor_id']).inTable('vendors');
    });

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_assets_vendor
      ON assets (tenant, vendor_id)
      WHERE vendor_id IS NOT NULL
    `);
  }

  // attributes.manufacturer / attributes.model → columns, then drop the keys.
  // `jsonb_exists(...)` rather than the `?` operator: knex reads a bare `?` in
  // a raw string as a positional binding and rewrites it to `$1`.
  await knex.raw(`
    UPDATE assets
    SET manufacturer = COALESCE(NULLIF(manufacturer, ''), NULLIF(trim(attributes->>'manufacturer'), '')),
        model = COALESCE(NULLIF(model, ''), NULLIF(trim(attributes->>'model'), '')),
        attributes = attributes - 'manufacturer' - 'model'
    WHERE attributes IS NOT NULL
      AND (jsonb_exists(attributes, 'manufacturer') OR jsonb_exists(attributes, 'model'))
  `);

  // Fill what is still empty from the RMM system_info blocks.
  for (const table of ['workstation_assets', 'server_assets']) {
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) continue;
    await knex.raw(`
      UPDATE assets a
      SET manufacturer = COALESCE(
            a.manufacturer,
            NULLIF(trim(e.system_info->>'manufacturer'), ''),
            NULLIF(trim(e.system_info->>'systemManufacturer'), '')
          ),
          model = COALESCE(
            a.model,
            NULLIF(trim(e.system_info->>'model'), ''),
            NULLIF(trim(e.system_info->>'systemModel'), '')
          )
      FROM ${table} e
      WHERE e.tenant = a.tenant
        AND e.asset_id = a.asset_id
        AND e.system_info IS NOT NULL
        AND (a.manufacturer IS NULL OR a.model IS NULL)
    `);
  }
};

exports.down = async function down(knex) {
  const hasManufacturer = await knex.schema.hasColumn('assets', 'manufacturer');
  if (!hasManufacturer) return;

  // Put the two values `up` lifted out of `attributes` back where they were,
  // or the rollback would quietly take an MSP's hardware identity with it.
  // The columns the roll-forward introduced (vendor, cost, order number) have
  // no earlier home and are dropped.
  await knex.raw(`
    UPDATE assets
    SET attributes = COALESCE(attributes, '{}'::jsonb)
      || CASE WHEN NULLIF(trim(COALESCE(manufacturer, '')), '') IS NULL
              THEN '{}'::jsonb ELSE jsonb_build_object('manufacturer', manufacturer) END
      || CASE WHEN NULLIF(trim(COALESCE(model, '')), '') IS NULL
              THEN '{}'::jsonb ELSE jsonb_build_object('model', model) END
    WHERE manufacturer IS NOT NULL OR model IS NOT NULL
  `);

  await knex.raw('DROP INDEX IF EXISTS idx_assets_vendor');
  await knex.schema.alterTable('assets', (table) => {
    table.dropForeign(['tenant', 'vendor_id']);
    table.dropColumn('manufacturer');
    table.dropColumn('model');
    table.dropColumn('vendor_id');
    table.dropColumn('purchase_cost');
    table.dropColumn('purchase_cost_currency');
    table.dropColumn('order_number');
  });
};
