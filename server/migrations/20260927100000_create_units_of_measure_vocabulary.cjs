// Exact seed projection of packages/core/src/lib/unitOfMeasure.ts.
const units = [
  ['each', 'C62', 'unitOfMeasure.labels.each', 'count'], ['piece', 'H87', 'unitOfMeasure.labels.piece', 'count'],
  ['box', 'BX', 'unitOfMeasure.labels.box', 'count'], ['seat', 'C62', 'unitOfMeasure.labels.seat', 'count'],
  ['license', 'C62', 'unitOfMeasure.labels.license', 'count'], ['device', 'C62', 'unitOfMeasure.labels.device', 'count'],
  ['user', 'C62', 'unitOfMeasure.labels.user', 'count'], ['kit', 'C62', 'unitOfMeasure.labels.kit', 'count'],
  ['hour', 'HUR', 'unitOfMeasure.labels.hour', 'time'], ['day', 'DAY', 'unitOfMeasure.labels.day', 'time'],
  ['week', 'WEE', 'unitOfMeasure.labels.week', 'time'], ['month', 'MON', 'unitOfMeasure.labels.month', 'time'],
  ['year', 'ANN', 'unitOfMeasure.labels.year', 'time'], ['minute', 'MIN', 'unitOfMeasure.labels.minute', 'time'],
  ['gigabyte', 'E34', 'unitOfMeasure.labels.gigabyte', 'volume'], ['terabyte', '4L', 'unitOfMeasure.labels.terabyte', 'volume'],
  ['liter', 'LTR', 'unitOfMeasure.labels.liter', 'volume'], ['kilogram', 'KGM', 'unitOfMeasure.labels.kilogram', 'mass'],
  ['meter', 'MTR', 'unitOfMeasure.labels.meter', 'length'],
];

exports.config = { transaction: false };

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('units_of_measure'))) {
    await knex.raw(`CREATE TABLE units_of_measure (
      unit_key text PRIMARY KEY, code text NOT NULL, label_key text NOT NULL, kind text NOT NULL,
      is_system boolean NOT NULL DEFAULT true
    )`);
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS units_of_measure_code_idx ON units_of_measure(code)');
  if (!(await knex.schema.hasTable('tenant_units_of_measure'))) {
    await knex.raw(`CREATE TABLE tenant_units_of_measure (
      tenant uuid NOT NULL, unit_id uuid NOT NULL DEFAULT gen_random_uuid(), code text NOT NULL, label text NOT NULL,
      kind text NOT NULL DEFAULT 'other', is_system boolean NOT NULL DEFAULT false,
      PRIMARY KEY (tenant, unit_id), UNIQUE (tenant, label)
    )`);
  }
  await knex.raw("COMMENT ON TABLE tenant_units_of_measure IS 'Tenant custom units use (tenant, unit_id) as the Citus-safe key; unit_id is a stable surrogate for future conversion-table references, with tenant/label uniqueness.'");
  const citus = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='citus') AS enabled");
  if (citus.rows[0]?.enabled) {
    const globalDist = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_dist_partition WHERE logicalrelid='units_of_measure'::regclass) AS yes");
    if (!globalDist.rows[0]?.yes) await knex.raw("SELECT create_reference_table('units_of_measure')");
    const dist = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_dist_partition WHERE logicalrelid='tenant_units_of_measure'::regclass) AS yes");
    if (!dist.rows[0]?.yes) await knex.raw("SELECT create_distributed_table('tenant_units_of_measure', 'tenant', colocate_with => 'tenants')");
  }
  for (const [unit_key, code, label_key, kind] of units) {
    await knex('units_of_measure').insert({ unit_key, code, label_key, kind, is_system: true }).onConflict('unit_key').merge({ code, label_key, kind, is_system: true });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasTable('tenant_units_of_measure')) await knex.schema.dropTable('tenant_units_of_measure');
  if (await knex.schema.hasTable('units_of_measure')) await knex.schema.dropTable('units_of_measure');
};
