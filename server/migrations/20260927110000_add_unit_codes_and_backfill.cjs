const targets = [
  ['service_catalog', 'unit_of_measure'],
  ['contract_line_service_usage_config', 'unit_of_measure'],
  ['contract_template_line_service_usage_config', 'unit_of_measure'],
  ['contract_line_preset_services', 'unit_of_measure'],
  ['quote_items', 'unit_of_measure'],
];
// Keep this CASE in sync with knownUnitCodeForLabel in shared/billingClients/unitOfMeasure.ts.
const known = `CASE lower(trim({label}))
  WHEN 'each' THEN 'C62' WHEN 'ea' THEN 'C62' WHEN 'unit' THEN 'C62' WHEN 'each.' THEN 'C62'
  WHEN 'hour' THEN 'HUR' WHEN 'hrs' THEN 'HUR' WHEN 'hr' THEN 'HUR'
  WHEN 'day' THEN 'DAY' WHEN 'days' THEN 'DAY' WHEN 'week' THEN 'WEE' WHEN 'weeks' THEN 'WEE'
  WHEN 'month' THEN 'MON' WHEN 'mon' THEN 'MON' WHEN 'year' THEN 'ANN' WHEN 'annum' THEN 'ANN'
  WHEN 'hours' THEN 'HUR' WHEN 'minute' THEN 'MIN' WHEN 'min' THEN 'MIN'
  WHEN 'gb' THEN 'E34' WHEN 'tb' THEN '4L' WHEN 'liter' THEN 'LTR' WHEN 'litre' THEN 'LTR'
  WHEN 'kg' THEN 'KGM' WHEN 'kilogram' THEN 'KGM' WHEN 'meter' THEN 'MTR' WHEN 'metre' THEN 'MTR'
  WHEN 'piece' THEN 'H87' WHEN 'pc' THEN 'H87' WHEN 'box' THEN 'BX' ELSE NULL END`;
const hasColumn = (knex, table, column) => knex.schema.hasColumn(table, column);

exports.config = { transaction: false };
async function addOwnedColumn(knex, table, column) {
  if (await hasColumn(knex, table, column)) return false;
  await knex.raw(`ALTER TABLE ${table} ADD COLUMN ${column} text NULL`);
  await knex('uom_migration_owned_objects').insert({ migration: '20260927110000', object_name: `${table}.${column}` }).onConflict().ignore();
  return true;
}
exports.up = async (knex) => {
  for (const [table, label] of [...targets, ['invoice_charges', 'unit_label']]) {
    if (!(await knex.schema.hasTable(table))) continue;
    await addOwnedColumn(knex, table, 'unit_code');
    if (table === 'invoice_charges') await addOwnedColumn(knex, table, 'unit_label');
    if (table === 'invoice_charges' || !(await hasColumn(knex, table, label))) continue;
    const mapping = known.replaceAll('{label}', `"${label}"`);
    const tenants = await knex(table).distinct('tenant').whereNotNull('tenant');
    for (const { tenant } of tenants) {
      await knex.raw(`UPDATE ${table} SET unit_code = ${mapping} WHERE tenant = ? AND unit_code IS NULL AND "${label}" IS NOT NULL`, [tenant]);
      await knex.raw(`UPDATE ${table} SET unit_code = 'C62' WHERE tenant = ? AND unit_code IS NULL AND nullif(trim("${label}"), '') IS NOT NULL`, [tenant]);
      await knex.raw(`INSERT INTO tenant_units_of_measure(tenant, code, label, kind)
        SELECT DISTINCT tenant, 'C62', trim("${label}"), 'other' FROM ${table}
        WHERE tenant = ? AND nullif(trim("${label}"), '') IS NOT NULL AND (${mapping}) IS NULL
        ON CONFLICT (tenant, label) DO NOTHING`, [tenant]);
    }
  }
  // Snapshot historical charge units only where a catalog service can identify them.
  if (await knex.schema.hasTable('invoice_charges') && await knex.schema.hasTable('service_catalog')) {
    const serviceCol = await hasColumn(knex, 'invoice_charges', 'service_id');
    // Both tables are tenant-colocated in Citus; the join predicate retains the distribution key.
    if (serviceCol) await knex.raw(`UPDATE invoice_charges ic SET unit_code=sc.unit_code, unit_label=sc.unit_of_measure
      FROM service_catalog sc WHERE ic.tenant=sc.tenant AND ic.service_id=sc.service_id
      AND ic.unit_code IS NULL AND sc.unit_code IS NOT NULL`);
  }
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasTable('uom_migration_owned_objects'))) return;
  const owned = await knex('uom_migration_owned_objects').where({ migration: '20260927110000' }).pluck('object_name');
  for (const entry of owned) {
    const [table, column] = String(entry).split('.');
    if (table && column && await knex.schema.hasTable(table) && await hasColumn(knex, table, column)) {
      await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  }
  await knex('uom_migration_owned_objects').where({ migration: '20260927110000' }).del();
};
