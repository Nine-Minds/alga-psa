const units = [
  ['C62', 'billing.units.each', 'count'], ['HUR', 'billing.units.hour', 'time'],
  ['DAY', 'billing.units.day', 'time'], ['WEE', 'billing.units.week', 'time'],
  ['MON', 'billing.units.month', 'time'], ['ANN', 'billing.units.year', 'time'],
  ['E34', 'billing.units.gigabyte', 'volume'], ['4L', 'billing.units.terabyte', 'volume'],
  ['KGM', 'billing.units.kilogram', 'mass'], ['MTR', 'billing.units.meter', 'length'],
  ['LTR', 'billing.units.liter', 'volume'], ['MIN', 'billing.units.minute', 'time'],
  ['DAY', 'billing.units.day', 'time'], ['SET', 'billing.units.set', 'count']
];

exports.config = { transaction: false };

exports.up = async (knex) => {
  await knex.raw(`CREATE TABLE IF NOT EXISTS units_of_measure (
    code text PRIMARY KEY, label_key text NOT NULL, kind text NOT NULL,
    is_system boolean NOT NULL DEFAULT true
  )`);
  await knex.raw(`CREATE TABLE IF NOT EXISTS tenant_units_of_measure (
    tenant uuid NOT NULL, code text NOT NULL, label text NOT NULL,
    kind text NOT NULL DEFAULT 'other', is_system boolean NOT NULL DEFAULT false,
    PRIMARY KEY (tenant, code, label)
  )`);
  const citus = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='citus') AS enabled");
  if (citus.rows[0]?.enabled) {
    const globalDist = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_dist_partition WHERE logicalrelid='units_of_measure'::regclass) AS yes");
    if (!globalDist.rows[0]?.yes) await knex.raw("SELECT create_reference_table('units_of_measure')");
    const dist = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_dist_partition WHERE logicalrelid='tenant_units_of_measure'::regclass) AS yes");
    if (!dist.rows[0]?.yes) await knex.raw("SELECT create_distributed_table('tenant_units_of_measure', 'tenant', colocate_with => 'tenants')");
  }
  for (const [code, label_key, kind] of units) {
    await knex('units_of_measure').insert({ code, label_key, kind, is_system: true }).onConflict('code').merge({ label_key, kind, is_system: true });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasTable('tenant_units_of_measure')) await knex.schema.dropTable('tenant_units_of_measure');
  if (await knex.schema.hasTable('units_of_measure')) await knex.schema.dropTable('units_of_measure');
};
