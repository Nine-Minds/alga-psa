'use strict';

/**
 * Verbatim invoice line text for template contract lines, mirroring
 * `contract_lines.invoice_line_description` (migration 20260703140000). The
 * ContractLineEditDialog authors it and the template clone copies it onto the
 * live line so the text prints on the generated invoice.
 */

const TABLE = 'contract_template_lines';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (!(await knex.schema.hasColumn(TABLE, 'invoice_line_description'))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN invoice_line_description text`);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (await knex.schema.hasColumn(TABLE, 'invoice_line_description')) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN invoice_line_description`);
  }
};

exports.config = { transaction: false };
