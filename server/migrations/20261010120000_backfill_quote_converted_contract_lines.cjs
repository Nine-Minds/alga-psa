/**
 * alga0002168: quote conversion used to write every contract line inactive (and
 * the client assignment active while the header was still a draft), so the first
 * invoice for the client failed with RECURRING_PERIODS_NOT_MATERIALIZED.
 *
 * Backfill only. Plain tenant-scoped UPDATEs: no DDL, no FK changes, no period
 * creation (service periods are resynced on the next activation/materialization).
 *
 *  1. Quote-converted contracts whose lines are ALL inactive -> lines active.
 *     A contract where someone removed some lines keeps at least one active line,
 *     so it never matches.
 *  2. Of those quote-converted contracts, ones whose header is still a draft ->
 *     client_contracts.is_active=false (the wizard draft shape).
 */
exports.config = { transaction: true };

const QUOTE_CONVERTED = `c.template_metadata->>'conversion_kind' = 'quote_to_contract'`;

exports.up = async function up(knex) {
  const required = ['contracts', 'contract_lines', 'client_contracts'];
  for (const table of required) {
    if (!(await knex.schema.hasTable(table))) return;
  }
  if (!(await knex.schema.hasColumn('contracts', 'template_metadata'))) return;

  // Step 2 first-class selection must use the pre-heal state, but it only depends
  // on header status and conversion kind, so ordering does not matter.
  await knex.raw(`
    UPDATE contract_lines cl
       SET is_active = true, updated_at = now()
      FROM contracts c
     WHERE c.tenant = cl.tenant
       AND c.contract_id = cl.contract_id
       AND ${QUOTE_CONVERTED}
       AND cl.is_active = false
       AND NOT EXISTS (
         SELECT 1 FROM contract_lines other
          WHERE other.tenant = cl.tenant
            AND other.contract_id = cl.contract_id
            AND other.is_active = true
       )
  `);

  await knex.raw(`
    UPDATE client_contracts cc
       SET is_active = false, updated_at = now()
      FROM contracts c
     WHERE c.tenant = cc.tenant
       AND c.contract_id = cc.contract_id
       AND ${QUOTE_CONVERTED}
       AND c.status = 'draft'
       AND cc.is_active = true
  `);
};

exports.down = async function down() {
  // Data backfill; the previous (broken) state is not worth restoring.
};
