/**
 * Refactor standard_statuses to be a global reference table (no tenant column)
 * This prepares it to become a Citus reference table
 */

exports.up = async function (knex) {
  console.log('Refactoring standard_statuses to global reference table...');
  
  // Check if standard_statuses table exists
  const tableExists = await knex.schema.hasTable('standard_statuses');
  if (!tableExists) {
    console.log('standard_statuses table does not exist, skipping');
    return;
  }

  // Check if tenant column exists
  const hasTenanColumn = await knex.schema.hasColumn('standard_statuses', 'tenant');
  if (!hasTenanColumn) {
    console.log('standard_statuses already has no tenant column, skipping');
    return;
  }

  // 1) Remove any tenant-specific foreign keys or constraints
  await knex.raw(`ALTER TABLE IF EXISTS statuses DROP COLUMN IF EXISTS standard_status_id CASCADE`);
  await knex.raw(`ALTER TABLE IF EXISTS project_status_mappings DROP COLUMN IF EXISTS standard_status_id CASCADE`);

  // 2) Create new table without tenant column
  await knex.schema.createTable('standard_statuses_new', (table) => {
    table.uuid('standard_status_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 50).notNullable();
    table.text('item_type').notNullable();
    table.integer('display_order').notNullable();
    table.boolean('is_closed').notNullable().defaultTo(false);
    table.boolean('is_default').notNullable().defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['name', 'item_type']);
  });

  // Add item_type check constraint
  await knex.raw(`
    ALTER TABLE standard_statuses_new
    ADD CONSTRAINT standard_statuses_item_type_check
    CHECK (item_type IN ('project', 'project_task', 'ticket', 'interaction'))
  `);

  // 3) Migrate data - deduplicate across tenants, keeping the best representative
  await knex.raw(`
    INSERT INTO standard_statuses_new
      (standard_status_id, name, item_type, display_order, is_closed, is_default, created_at, updated_at)
    SELECT DISTINCT ON (LOWER(ss.name), ss.item_type)
      gen_random_uuid() AS standard_status_id,
      ss.name,
      ss.item_type,
      COALESCE(ss.display_order, 0) AS display_order,
      COALESCE(ss.is_closed, false) AS is_closed,
      COALESCE(ss.is_default, false) AS is_default,
      COALESCE(ss.created_at, NOW()) AS created_at,
      COALESCE(ss.updated_at, NOW()) AS updated_at
    FROM standard_statuses ss
    ORDER BY
      LOWER(ss.name), ss.item_type,
      COALESCE(ss.is_default, false) DESC,
      COALESCE(ss.display_order, 0) ASC,
      COALESCE(ss.created_at, NOW()) ASC,
      ss.standard_status_id ASC
  `);

  // 4) Replace the old table
  await knex.schema.dropTable('standard_statuses');
  await knex.schema.renameTable('standard_statuses_new', 'standard_statuses');
  
  console.log('Successfully refactored standard_statuses to global reference table');
};

exports.down = async function (knex) {
  // This is effectively irreversible since we lose tenant associations
  throw new Error('Irreversible migration: standard_statuses converted to global reference table');
};