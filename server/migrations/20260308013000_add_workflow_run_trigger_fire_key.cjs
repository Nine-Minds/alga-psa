'use strict';

const UNIQUE_INDEX = 'workflow_runs_trigger_fire_key_unique';

exports.up = async function up(knex) {
  const hasTriggerFireKey = await knex.schema.hasColumn('workflow_runs', 'trigger_fire_key');
  if (!hasTriggerFireKey) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.text('trigger_fire_key');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
    ON workflow_runs (trigger_fire_key)
    WHERE trigger_fire_key IS NOT NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${UNIQUE_INDEX}`);

  const hasTriggerFireKey = await knex.schema.hasColumn('workflow_runs', 'trigger_fire_key');
  if (hasTriggerFireKey) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.dropColumn('trigger_fire_key');
    });
  }
};
