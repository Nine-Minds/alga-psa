exports.up = async function(knex) {
  await knex.schema.alterTable('invoice_templates', (table) => {
    // Add AssemblyScript source code column (can be large)
    table.text('assemblyScriptSource').nullable();
    // Add path to the compiled Wasm file
    table.string('wasmPath', 1024).nullable(); // Using string with a reasonable length
  });
};

exports.down = async function(knex) {
  // Check if columns exist before dropping to make 'down' safer
  const hasAsmCol = await knex.schema.hasColumn('invoice_templates', 'assemblyScriptSource');
  const hasWasmCol = await knex.schema.hasColumn('invoice_templates', 'wasmPath');

  await knex.schema.alterTable('invoice_templates', (table) => {
    if (hasAsmCol) {
      table.dropColumn('assemblyScriptSource');
    }
    if (hasWasmCol) {
      table.dropColumn('wasmPath');
    }
  });
};