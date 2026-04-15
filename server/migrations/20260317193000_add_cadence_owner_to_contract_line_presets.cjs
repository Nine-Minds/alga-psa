exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('contract_line_presets', 'cadence_owner');
  if (!hasColumn) {
    await knex.schema.alterTable('contract_line_presets', (table) => {
      table.string('cadence_owner', 20).nullable();
    });
  }

  await knex('contract_line_presets')
    .whereNull('cadence_owner')
    .update({ cadence_owner: 'client' });

  await knex.raw(`
    ALTER TABLE contract_line_presets
    DROP CONSTRAINT IF EXISTS contract_line_presets_cadence_owner_check
  `);

  await knex.raw(`
    ALTER TABLE contract_line_presets
    ADD CONSTRAINT contract_line_presets_cadence_owner_check
    CHECK (cadence_owner IN ('client', 'contract'))
  `);

  await knex.schema.alterTable('contract_line_presets', (table) => {
    table.string('cadence_owner', 20).notNullable().defaultTo('client').alter();
  });
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE contract_line_presets
    DROP CONSTRAINT IF EXISTS contract_line_presets_cadence_owner_check
  `);

  const hasColumn = await knex.schema.hasColumn('contract_line_presets', 'cadence_owner');
  if (hasColumn) {
    await knex.schema.alterTable('contract_line_presets', (table) => {
      table.dropColumn('cadence_owner');
    });
  }
};
