// server/migrations/20250429230000_remove_wasm_path_from_invoice_templates.cjs

/**
 * Migration to remove the wasmPath column from invoice_templates table
 * Now that we're storing the WASM binary directly in the database,
 * we no longer need to store the path to the WASM file.
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const tableName = 'invoice_templates';

  // Check if the column exists before attempting to drop it
  const hasWasmPath = await knex.schema.hasColumn(tableName, 'wasmPath');
  
  if (hasWasmPath) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('wasmPath');
    });
    console.log(`Dropped wasmPath column from ${tableName}.`);
  } else {
    console.log(`Column wasmPath does not exist in ${tableName}, skipping.`);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const tableName = 'invoice_templates';
  
  // Check if the column already exists before attempting to add it
  const hasWasmPath = await knex.schema.hasColumn(tableName, 'wasmPath');
  
  if (!hasWasmPath) {
    await knex.schema.alterTable(tableName, (table) => {
      // Re-add the wasmPath column
      table.string('wasmPath', 1024).nullable();
    });
    console.log(`Added wasmPath column back to ${tableName}.`);
  } else {
    console.log(`Column wasmPath already exists in ${tableName}, skipping.`);
  }
};