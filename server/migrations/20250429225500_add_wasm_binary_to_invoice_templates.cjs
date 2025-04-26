// server/migrations/20250429225500_add_wasm_binary_to_invoice_templates.cjs

/**
 * Migration to add wasmBinary column to invoice_templates table
 * This aligns the tenant templates with standard templates by storing
 * the compiled WASM binary directly in the database instead of just a file path.
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const tableName = 'invoice_templates';

  await knex.schema.alterTable(tableName, (table) => {
    // Add the new binary column for Wasm data
    // Using specificType for PostgreSQL to ensure proper BYTEA type
    table.specificType('wasmBinary', 'BYTEA')
      .nullable()
      .comment('Stores the compiled Wasm binary data directly.');
  });

  console.log(`Added wasmBinary column to ${tableName}.`);
  
  // Note: We're keeping the wasmPath column for backward compatibility
  // It will be removed in a future migration after all templates are migrated
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const tableName = 'invoice_templates';
  
  // Check if the column exists before attempting to drop it
  const hasWasmBinary = await knex.schema.hasColumn(tableName, 'wasmBinary');
  
  if (hasWasmBinary) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('wasmBinary');
    });
    console.log(`Dropped wasmBinary column from ${tableName}.`);
  }
};