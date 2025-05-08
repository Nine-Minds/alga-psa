/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Create an ENUM type named public.workflow_execution_type
  await knex.raw("CREATE TYPE public.workflow_execution_type AS ENUM ('system', 'tenant');");

  // 2. Remove the foreign key constraint workflow_executions_version_id_foreign
  await knex.raw('ALTER TABLE public.workflow_executions DROP CONSTRAINT IF EXISTS workflow_executions_version_id_foreign;');

  // 3. Add a new column workflow_type
  await knex.schema.alterTable('public.workflow_executions', (table) => {
    table.enum('workflow_type', ['system', 'tenant'], {
      useNative: true,
      enumName: 'workflow_execution_type',
      existingType: true
    });
  });

  // 4. Update existing rows in workflow_executions
  await knex('public.workflow_executions').whereNull('workflow_type').update({ workflow_type: 'tenant' });

  // 5. Alter the workflow_type column to be NOT NULL
  await knex.schema.alterTable('public.workflow_executions', (table) => {
    table.enum('workflow_type', ['system', 'tenant'], {
      useNative: true,
      enumName: 'workflow_execution_type',
      existingType: true
    }).notNullable().alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // 1. Drop the workflow_type column
  await knex.schema.alterTable('public.workflow_executions', (table) => {
    table.dropColumn('workflow_type');
  });

  // 2. Drop the public.workflow_execution_type ENUM type
  await knex.raw('DROP TYPE IF EXISTS public.workflow_execution_type;');
};