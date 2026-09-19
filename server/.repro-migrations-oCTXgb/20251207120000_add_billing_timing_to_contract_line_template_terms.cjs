/**
 * Migration: Add billing_timing to contract_line_template_terms
 *
 * The 20251025120000 migration added billing_timing to:
 * - contract_lines
 * - contract_template_line_terms
 * - client_contract_line_terms
 *
 * But it missed contract_line_template_terms, which stores terms for
 * contract_lines cloned from templates. This migration fixes that gap.
 */

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('contract_line_template_terms')) {
    const hasColumn = await knex.schema.hasColumn('contract_line_template_terms', 'billing_timing');
    if (!hasColumn) {
      await knex.schema.alterTable('contract_line_template_terms', (table) => {
        table.string('billing_timing', 16).notNullable().defaultTo('arrears');
      });

      await knex.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'contract_line_template_terms_timing_check'
          ) THEN
            ALTER TABLE contract_line_template_terms
            ADD CONSTRAINT contract_line_template_terms_timing_check
            CHECK (billing_timing IN ('arrears', 'advance'));
          END IF;
        END$$;
      `);

      console.log('Added billing_timing column to contract_line_template_terms');
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('contract_line_template_terms')) {
    await knex.raw('ALTER TABLE contract_line_template_terms DROP CONSTRAINT IF EXISTS contract_line_template_terms_timing_check');

    if (await knex.schema.hasColumn('contract_line_template_terms', 'billing_timing')) {
      await knex.schema.alterTable('contract_line_template_terms', (table) => {
        table.dropColumn('billing_timing');
      });
    }
  }
};
