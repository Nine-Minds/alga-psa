const targets = [
  ['service_catalog', 'unit_of_measure'],
  ['contract_line_service_usage_config', 'unit_of_measure'],
  ['contract_template_line_service_usage_config', 'unit_of_measure'],
  ['contract_line_preset_services', 'unit_of_measure'],
  ['quote_items', 'unit_of_measure'],
];
const known = `CASE lower(trim({label}))
  WHEN 'each' THEN 'C62' WHEN 'ea' THEN 'C62' WHEN 'unit' THEN 'C62' WHEN 'each.' THEN 'C62'
  WHEN 'hour' THEN 'HUR' WHEN 'hrs' THEN 'HUR' WHEN 'hr' THEN 'HUR'
  WHEN 'day' THEN 'DAY' WHEN 'days' THEN 'DAY' WHEN 'week' THEN 'WEE' WHEN 'weeks' THEN 'WEE'
  WHEN 'month' THEN 'MON' WHEN 'mon' THEN 'MON' WHEN 'year' THEN 'ANN' WHEN 'annum' THEN 'ANN'
  WHEN 'gb' THEN 'E34' WHEN 'tb' THEN '4L' ELSE NULL END`;
const hasColumn = (knex, table, column) => knex.schema.hasColumn(table, column);

exports.config = { transaction: false };
exports.up = async (knex) => {
  for (const [table, label] of [...targets, ['invoice_charges', 'unit_label']]) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await hasColumn(knex, table, 'unit_code'))) await knex.raw(`ALTER TABLE ${table} ADD COLUMN unit_code text NULL`);
    if (table === 'invoice_charges' && !(await hasColumn(knex, table, 'unit_label'))) await knex.raw('ALTER TABLE invoice_charges ADD COLUMN unit_label text NULL');
    if (table === 'invoice_charges' || !(await hasColumn(knex, table, label))) continue;
    const mapping = known.replaceAll('{label}', `"${label}"`);
    await knex.raw(`UPDATE ${table} SET unit_code = ${mapping} WHERE unit_code IS NULL AND "${label}" IS NOT NULL`);
    await knex.raw(`UPDATE ${table} SET unit_code = 'C62' WHERE unit_code IS NULL AND nullif(trim("${label}"), '') IS NOT NULL`);
    await knex.raw(`INSERT INTO tenant_units_of_measure(tenant, code, label, kind)
      SELECT DISTINCT tenant, 'C62', trim("${label}"), 'other' FROM ${table}
      WHERE nullif(trim("${label}"), '') IS NOT NULL AND (${mapping}) IS NULL
      ON CONFLICT (tenant, code, label) DO NOTHING`);
  }
  // Snapshot historical charge units only where a catalog service can identify them.
  if (await knex.schema.hasTable('invoice_charges') && await knex.schema.hasTable('service_catalog')) {
    const serviceCol = await hasColumn(knex, 'invoice_charges', 'service_id');
    if (serviceCol) await knex.raw(`UPDATE invoice_charges ic SET unit_code=sc.unit_code, unit_label=sc.unit_of_measure
      FROM service_catalog sc WHERE ic.tenant=sc.tenant AND ic.service_id=sc.service_id
      AND ic.unit_code IS NULL AND sc.unit_code IS NOT NULL`);
  }
};

exports.down = async (knex) => {
  for (const table of ['service_catalog','contract_line_service_usage_config','contract_template_line_service_usage_config','contract_line_preset_services','quote_items','invoice_charges']) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await hasColumn(knex, table, 'unit_code')) await knex.raw(`ALTER TABLE ${table} DROP COLUMN unit_code`);
    if (table === 'invoice_charges' && await hasColumn(knex, table, 'unit_label')) await knex.raw('ALTER TABLE invoice_charges DROP COLUMN unit_label');
  }
};
