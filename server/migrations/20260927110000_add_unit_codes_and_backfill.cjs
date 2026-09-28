const targets = [
  ['service_catalog', 'unit_of_measure'],
  ['contract_line_service_usage_config', 'unit_of_measure'],
  ['contract_template_line_service_usage_config', 'unit_of_measure'],
  ['contract_line_preset_services', 'unit_of_measure'],
  ['quote_items', 'unit_of_measure'],
];
// Known free-text variants → Rec 20 code. Mirror of UNIT_LABEL_VARIANTS in
// packages/core/src/lib/unitOfMeasure.ts (migrations cannot import TS);
// server/src/test/unit/billing/unitCodesBackfillMigration.parity.test.ts asserts parity.
const KNOWN_UNIT_LABELS = {
  each: 'C62', ea: 'C62', 'each.': 'C62', unit: 'C62', units: 'C62', one: 'C62',
  piece: 'H87', pieces: 'H87', pc: 'H87', pcs: 'H87',
  box: 'BX', boxes: 'BX', bx: 'BX',
  seat: 'C62', seats: 'C62',
  license: 'C62', licenses: 'C62', licence: 'C62', licences: 'C62',
  device: 'C62', devices: 'C62',
  user: 'C62', users: 'C62',
  kit: 'C62', kits: 'C62',
  hour: 'HUR', hours: 'HUR', hr: 'HUR', hrs: 'HUR',
  day: 'DAY', days: 'DAY',
  week: 'WEE', weeks: 'WEE', wk: 'WEE', wks: 'WEE',
  month: 'MON', months: 'MON', mon: 'MON', mo: 'MON', mos: 'MON',
  year: 'ANN', years: 'ANN', yr: 'ANN', yrs: 'ANN', annum: 'ANN',
  minute: 'MIN', minutes: 'MIN', min: 'MIN', mins: 'MIN',
  gb: 'E34', gigabyte: 'E34', gigabytes: 'E34',
  tb: '4L', terabyte: '4L', terabytes: '4L',
  liter: 'LTR', liters: 'LTR', litre: 'LTR', litres: 'LTR',
  kg: 'KGM', kilogram: 'KGM', kilograms: 'KGM',
  meter: 'MTR', meters: 'MTR', metre: 'MTR', metres: 'MTR',
};
const quote = (value) => `'${value.replace(/'/g, "''")}'`;
const known = `CASE lower(trim({label}))\n  ${Object.entries(KNOWN_UNIT_LABELS)
  .map(([label, code]) => `WHEN ${quote(label)} THEN ${quote(code)}`)
  .join('\n  ')}\n  ELSE NULL END`;
const hasColumn = (knex, table, column) => knex.schema.hasColumn(table, column);

exports.config = { transaction: false };
async function addOwnedColumn(knex, table, column) {
  if (await hasColumn(knex, table, column)) return false;
  await knex.raw(`ALTER TABLE ${table} ADD COLUMN ${column} text NULL`);
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
  for (const [table] of [...targets, ['invoice_charges', 'unit_label']]) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await hasColumn(knex, table, 'unit_code')) await knex.raw(`ALTER TABLE ${table} DROP COLUMN unit_code`);
    if (table === 'invoice_charges' && await hasColumn(knex, table, 'unit_label')) {
      await knex.raw('ALTER TABLE invoice_charges DROP COLUMN unit_label');
    }
  }
};

// Exposed for the parity test only; knex ignores extra exports.
exports.KNOWN_UNIT_LABELS = KNOWN_UNIT_LABELS;
