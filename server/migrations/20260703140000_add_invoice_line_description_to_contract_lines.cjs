/**
 * Per-contract-line custom invoice description.
 *
 * Fixed-fee recurring invoice lines derive their text from the contract line
 * name ("Fixed Plan: {name}"). Long-standing customer arrangements often need
 * hand-crafted wording instead ("Monthly phone system maintenance per 2019
 * agreement"). This nullable override is used verbatim as the invoice line
 * description when set, removing the need to hand-edit every recurring draft.
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('contract_lines', 'invoice_line_description');
  if (!hasColumn) {
    await knex.schema.table('contract_lines', (table) => {
      table.text('invoice_line_description').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('contract_lines', 'invoice_line_description');
  if (hasColumn) {
    await knex.schema.table('contract_lines', (table) => {
      table.dropColumn('invoice_line_description');
    });
  }
};
