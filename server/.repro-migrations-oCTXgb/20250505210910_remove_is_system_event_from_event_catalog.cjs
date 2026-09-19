'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

// It's suspected the table name might be 'system_event_catalog' based on the
// migration that created it (20250505210649_create_system_event_catalog_table.cjs).
// Please verify the actual table name. For this change, 'system_event_catalog' is assumed.
const TARGET_TABLE_NAME = 'system_event_catalog';

exports.up = async function(knex) {
  const tableExists = await knex.schema.hasTable(TARGET_TABLE_NAME);
  if (tableExists) {
    const columnExists = await knex.schema.hasColumn(TARGET_TABLE_NAME, 'is_system_event');
    if (columnExists) {
      await knex.schema.alterTable(TARGET_TABLE_NAME, (table) => {
        table.dropColumn('is_system_event');
      });
    } else {
      console.log(`Column 'is_system_event' does not exist in table '${TARGET_TABLE_NAME}'. Skipping drop.`);
    }
  } else {
    console.log(`Table '${TARGET_TABLE_NAME}' does not exist. Skipping alterations.`);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const tableExists = await knex.schema.hasTable(TARGET_TABLE_NAME);
  if (tableExists) {
    const columnExists = await knex.schema.hasColumn(TARGET_TABLE_NAME, 'is_system_event');
    if (!columnExists) {
      await knex.schema.alterTable(TARGET_TABLE_NAME, (table) => {
        table.boolean('is_system_event').defaultTo(false);
      });
    } else {
      console.log(`Column 'is_system_event' already exists in table '${TARGET_TABLE_NAME}'. Skipping add.`);
    }
  } else {
    console.log(`Table '${TARGET_TABLE_NAME}' does not exist. Skipping alterations.`);
  }
};
