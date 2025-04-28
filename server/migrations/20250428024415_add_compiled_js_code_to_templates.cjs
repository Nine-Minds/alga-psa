/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // === Tenant Templates ===
  await knex.schema.alterTable('invoice_templates', function(table) {
    // Add column to store compiled JavaScript code
    table.text('compiled_js_code');
    // Optionally remove wasmPath if it's no longer needed at all
    // table.dropColumn('wasmPath');
    // Rename assemblyScriptSource to typeScriptSource
    table.renameColumn('assemblyScriptSource', 'typeScriptSource');
  });

  // === Standard Templates ===
  // Check if the column exists before renaming (important for fresh setups/rollbacks)
  const hasWasmBinary = await knex.schema.hasColumn('standard_invoice_templates', 'wasmBinary');

  if (hasWasmBinary) {
      await knex.schema.alterTable('standard_invoice_templates', function(table) {
        // Rename wasmBinary to compiled_js_code
        table.renameColumn('wasmBinary', 'compiled_js_code');
      });

      // Change the type of the renamed column to TEXT
      // Note: This might involve data loss if Wasm binaries were stored.
      // A more complex migration might try to convert/recompile, but for this phase,
      // we assume standard templates will be repopulated with JS code later.
      // Using knex.raw for type change as direct alter type can be tricky across DBs.
      // Ensure compatibility with your specific database (e.g., PostgreSQL).
      await knex.raw('ALTER TABLE standard_invoice_templates ALTER COLUMN compiled_js_code TYPE TEXT USING compiled_js_code::text'); // Example for PostgreSQL
      // For other databases, the syntax might differ:
      // MySQL: await knex.raw('ALTER TABLE standard_invoice_templates MODIFY COLUMN compiled_js_code TEXT');
      // SQLite: SQLite doesn't strongly enforce types, altering might not be strictly necessary or might require table recreation.
  } else {
      // If wasmBinary doesn't exist, maybe compiled_js_code already does? Add it if not.
      const hasCompiledJsCode = await knex.schema.hasColumn('standard_invoice_templates', 'compiled_js_code');
      if (!hasCompiledJsCode) {
          await knex.schema.alterTable('standard_invoice_templates', function(table) {
              table.text('compiled_js_code');
          });
      }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // === Tenant Templates ===
  await knex.schema.alterTable('invoice_templates', function(table) {
    table.dropColumn('compiled_js_code');
    // If wasmPath was dropped in 'up', add it back here
    // table.string('wasmPath');
    // Rename typeScriptSource back to assemblyScriptSource
    table.renameColumn('typeScriptSource', 'assemblyScriptSource');
  });

  // === Standard Templates ===
  const hasCompiledJsCode = await knex.schema.hasColumn('standard_invoice_templates', 'compiled_js_code');
  if (hasCompiledJsCode) {
      // Change type back to BYTEA (or original binary type) - This might fail if data isn't binary compatible
      // Using knex.raw again for type change. Ensure compatibility.
      // This assumes the original type was BYTEA for PostgreSQL. Adjust if needed.
      await knex.raw('ALTER TABLE standard_invoice_templates ALTER COLUMN compiled_js_code TYPE BYTEA USING compiled_js_code::bytea'); // Example for PostgreSQL
      // MySQL: await knex.raw('ALTER TABLE standard_invoice_templates MODIFY COLUMN compiled_js_code BLOB'); // Or appropriate binary type
      // SQLite: Type changes are less strict.

      // Rename compiled_js_code back to wasmBinary
      await knex.schema.alterTable('standard_invoice_templates', function(table) {
        table.renameColumn('compiled_js_code', 'wasmBinary');
      });
  }
  // If compiled_js_code didn't exist, do nothing (it might have been wasmBinary originally)
};
