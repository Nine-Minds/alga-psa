// server/migrations/20250427170715_alter_standard_templates_wasm_binary.cjs

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const tableName = 'standard_invoice_templates';

  // Check if the columns to be dropped exist before attempting to drop them
  const hasWasmPath = await knex.schema.hasColumn(tableName, 'wasmPath');
  const hasAsSource = await knex.schema.hasColumn(tableName, 'assemblyScriptSource');

  await knex.schema.alterTable(tableName, (table) => {
    // Add the new binary column for Wasm data
    // Using specific type for PostgreSQL might be better if needed: table.specificType('wasmBinary', 'BYTEA')
    table.binary('wasmBinary').comment('Stores the compiled Wasm binary data directly.');

    // Drop columns if they exist
    if (hasWasmPath) {
        console.log(`Dropping column wasmPath from ${tableName}...`);
        table.dropColumn('wasmPath');
    }
    if (hasAsSource) {
        console.log(`Dropping column assemblyScriptSource from ${tableName}...`);
        table.dropColumn('assemblyScriptSource');
    }
  });
  console.log(`Added wasmBinary column to ${tableName}. Columns wasmPath and assemblyScriptSource dropped if they existed.`);
  // NOTE: Populating the wasmBinary column with actual data needs to be done separately.
  // This could involve reading files during migration (complex) or a separate script/manual update.
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const tableName = 'standard_invoice_templates';
  await knex.schema.alterTable(tableName, (table) => {
    // Re-add the columns that were removed in the 'up' migration
    // Ensure these match the original definitions if possible
    table.text('assemblyScriptSource').comment('AssemblyScript source code (re-added from rollback)');
    table.string('wasmPath').comment('Path to compiled Wasm file (re-added from rollback)');

    // Remove the binary column added in the 'up' migration
    table.dropColumn('wasmBinary');
  });
   console.log(`Rolled back changes for ${tableName}: Dropped wasmBinary, re-added wasmPath and assemblyScriptSource.`);
};
