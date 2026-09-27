// Exact seed projection of shared/billingClients/unitOfMeasure.ts.
const units = [
  ['each', 'C62', 'billing.units.each', 'count'], ['piece', 'H87', 'billing.units.piece', 'count'],
  ['box', 'BX', 'billing.units.box', 'count'], ['seat', 'C62', 'billing.units.seat', 'count'],
  ['license', 'C62', 'billing.units.license', 'count'], ['device', 'C62', 'billing.units.device', 'count'],
  ['user', 'C62', 'billing.units.user', 'count'], ['kit', 'C62', 'billing.units.kit', 'count'],
  ['hour', 'HUR', 'billing.units.hour', 'time'], ['day', 'DAY', 'billing.units.day', 'time'],
  ['week', 'WEE', 'billing.units.week', 'time'], ['month', 'MON', 'billing.units.month', 'time'],
  ['year', 'ANN', 'billing.units.year', 'time'], ['minute', 'MIN', 'billing.units.minute', 'time'],
  ['gigabyte', 'E34', 'billing.units.gigabyte', 'volume'], ['terabyte', '4L', 'billing.units.terabyte', 'volume'],
  ['liter', 'LTR', 'billing.units.liter', 'volume'], ['kilogram', 'KGM', 'billing.units.kilogram', 'mass'],
  ['meter', 'MTR', 'billing.units.meter', 'length'],
];

exports.config = { transaction: false };

exports.up = async (knex) => {
  await knex.raw(`CREATE TABLE IF NOT EXISTS uom_migration_owned_objects (
    migration text NOT NULL, object_name text NOT NULL, PRIMARY KEY (migration, object_name)
  )`);
  if (!(await knex.schema.hasTable('units_of_measure'))) {
    await knex.raw(`CREATE TABLE units_of_measure (
      unit_key text PRIMARY KEY, code text NOT NULL, label_key text NOT NULL, kind text NOT NULL,
      is_system boolean NOT NULL DEFAULT true
    )`);
    await knex('uom_migration_owned_objects').insert({ migration: '20260927100000', object_name: 'units_of_measure' }).onConflict().ignore();
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS units_of_measure_code_idx ON units_of_measure(code)');
  if (!(await knex.schema.hasTable('tenant_units_of_measure'))) {
    await knex.raw(`CREATE TABLE tenant_units_of_measure (
      tenant uuid NOT NULL, unit_id uuid NOT NULL DEFAULT gen_random_uuid(), code text NOT NULL, label text NOT NULL,
      kind text NOT NULL DEFAULT 'other', is_system boolean NOT NULL DEFAULT false,
      PRIMARY KEY (tenant, unit_id), UNIQUE (tenant, label)
    )`);
    await knex('uom_migration_owned_objects').insert({ migration: '20260927100000', object_name: 'tenant_units_of_measure' }).onConflict().ignore();
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
  if (await knex.schema.hasTable('uom_migration_owned_objects')) {
    const owned = await knex('uom_migration_owned_objects').where({ migration: '20260927100000' }).pluck('object_name');
    for (const table of ['tenant_units_of_measure', 'units_of_measure']) {
      if (owned.includes(table) && await knex.schema.hasTable(table)) await knex.schema.dropTable(table);
    }
    await knex('uom_migration_owned_objects').where({ migration: '20260927100000' }).del();
    const remaining = await knex('uom_migration_owned_objects').count('* as count').first();
    if (Number(remaining?.count ?? 0) === 0) await knex.schema.dropTable('uom_migration_owned_objects');
  }
};
