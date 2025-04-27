exports.up = async function(knex) {
  // 1. Add new columns to invoice_templates
  await knex.schema.alterTable('invoice_templates', (table) => {
    table.text('assemblyScriptSource'); // Store the AS source code
    table.text('wasmPath');             // Store the relative path to the compiled Wasm file
    table.boolean('isStandard').defaultTo(false).notNullable(); // Flag for standard templates
  });

  // 2. Make 'dsl' column nullable as it won't be used for Wasm templates
  await knex.schema.alterTable('invoice_templates', (table) => {
    table.text('dsl').nullable().alter();
  });

  // 3. Make 'tenant' column nullable to allow for standard templates (not tenant-specific)
  await knex.schema.alterTable('invoice_templates', (table) => {
    table.uuid('tenant').nullable().alter();
  });

  // 4. Drop the old standard_invoice_templates table as it's now redundant
  await knex.schema.dropTableIfExists('standard_invoice_templates');
};

exports.down = async function(knex) {
  // Recreate standard_invoice_templates (schema only, data lost)
  await knex.schema.createTable('standard_invoice_templates', (table) => {
    table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('name').notNullable();
    table.integer('version').notNullable();
    table.text('dsl').notNullable();
    table.boolean('is_default').defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Revert changes to invoice_templates
  await knex.schema.alterTable('invoice_templates', (table) => {
    table.dropColumn('assemblyScriptSource');
    table.dropColumn('wasmPath');
    table.dropColumn('isStandard');
  });

  // Make 'dsl' not nullable again (potential data loss if nulls existed)
  await knex.schema.alterTable('invoice_templates', (table) => {
    // Note: This might fail if any rows have NULL in dsl after the 'up' migration ran.
    // A more robust down migration might require handling those NULLs first.
    table.text('dsl').notNullable().alter();
  });

  // Make 'tenant' not nullable again (potential data loss if nulls existed)
   await knex.schema.alterTable('invoice_templates', (table) => {
    // Note: This might fail if any rows have NULL in tenant after the 'up' migration ran.
    table.uuid('tenant').notNullable().alter();
  });
};
