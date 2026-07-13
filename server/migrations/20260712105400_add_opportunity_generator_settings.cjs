'use strict';

exports.up = async function up(knex) {
  await knex.schema.alterTable('opportunity_settings', (table) => {
    table.integer('renewal_lead_days').notNullable().defaultTo(120);
    table.bigInteger('tm_threshold_cents').notNullable().defaultTo(120000);
    table.integer('asset_age_years').notNullable().defaultTo(6);
  });

  await knex.raw(`
    ALTER TABLE opportunity_settings
    ADD CONSTRAINT opportunity_settings_generator_thresholds_check
    CHECK (
      renewal_lead_days >= 1
      AND tm_threshold_cents >= 0
      AND asset_age_years >= 1
    )
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE opportunity_settings
    DROP CONSTRAINT IF EXISTS opportunity_settings_generator_thresholds_check
  `);
  await knex.schema.alterTable('opportunity_settings', (table) => {
    table.dropColumn('asset_age_years');
    table.dropColumn('tm_threshold_cents');
    table.dropColumn('renewal_lead_days');
  });
};
