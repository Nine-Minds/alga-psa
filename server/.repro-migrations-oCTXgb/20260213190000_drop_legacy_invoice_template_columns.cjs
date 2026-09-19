/**
 * Drop legacy invoice template columns now that templates render from canonical JSON AST (`templateAst`).
 *
 * Legacy columns removed:
 * - invoice_templates: assemblyScriptSource, wasmBinary
 * - standard_invoice_templates: dsl, assemblyScriptSource, sha, wasmBinary
 */

async function dropColumnIfExists(knex, tableName, columnName) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) return;

  await knex.schema.alterTable(tableName, (table) => {
    table.dropColumn(columnName);
  });
}

async function addColumnIfMissing(knex, tableName, columnName, addFn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (exists) return;

  await knex.schema.alterTable(tableName, (table) => {
    addFn(table);
  });
}

exports.up = async function up(knex) {
  await dropColumnIfExists(knex, 'invoice_templates', 'assemblyScriptSource');
  await dropColumnIfExists(knex, 'invoice_templates', 'wasmBinary');

  await dropColumnIfExists(knex, 'standard_invoice_templates', 'dsl');
  await dropColumnIfExists(knex, 'standard_invoice_templates', 'assemblyScriptSource');
  await dropColumnIfExists(knex, 'standard_invoice_templates', 'sha');
  await dropColumnIfExists(knex, 'standard_invoice_templates', 'wasmBinary');
};

exports.down = async function down(knex) {
  await addColumnIfMissing(knex, 'invoice_templates', 'assemblyScriptSource', (table) => {
    table.text('assemblyScriptSource').nullable();
  });
  await addColumnIfMissing(knex, 'invoice_templates', 'wasmBinary', (table) => {
    table.specificType('wasmBinary', 'BYTEA').nullable();
  });

  await addColumnIfMissing(knex, 'standard_invoice_templates', 'dsl', (table) => {
    table.text('dsl').nullable();
  });
  await addColumnIfMissing(knex, 'standard_invoice_templates', 'assemblyScriptSource', (table) => {
    table.text('assemblyScriptSource').nullable();
  });
  await addColumnIfMissing(knex, 'standard_invoice_templates', 'sha', (table) => {
    table.string('sha').nullable();
  });
  await addColumnIfMissing(knex, 'standard_invoice_templates', 'wasmBinary', (table) => {
    table.specificType('wasmBinary', 'BYTEA').nullable();
  });
};

