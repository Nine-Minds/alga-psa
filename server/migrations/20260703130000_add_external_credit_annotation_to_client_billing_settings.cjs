/**
 * Per-client "customer holds external credit" annotation.
 *
 * When a customer's credit balance lives in the accounting system (e.g. a
 * QBO customer credit from prepaid checks), Alga has no record of it and the
 * customer looks delinquent between invoice finalization and the bookkeeper
 * applying the credit. This flag plus note lets the MSP mark such clients so
 * the client portal and internal screens can say "not delinquent — credit on
 * file with accounting" instead.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('client_billing_settings');
  if (!hasTable) {
    return;
  }

  const hasFlag = await knex.schema.hasColumn('client_billing_settings', 'has_external_credit');
  if (!hasFlag) {
    await knex.schema.alterTable('client_billing_settings', (table) => {
      table.boolean('has_external_credit').notNullable().defaultTo(false);
      table.text('external_credit_note').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('client_billing_settings');
  if (!hasTable) {
    return;
  }

  const hasFlag = await knex.schema.hasColumn('client_billing_settings', 'has_external_credit');
  if (hasFlag) {
    await knex.schema.alterTable('client_billing_settings', (table) => {
      table.dropColumn('external_credit_note');
      table.dropColumn('has_external_credit');
    });
  }
};
