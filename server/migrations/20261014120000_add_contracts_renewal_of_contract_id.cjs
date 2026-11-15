/**
 * Durable renewal-contract marker (alga-2026-0002695): contracts.renewal_of_contract_id is the
 * contract a renewal draft was created from (written by createRenewalDraftForQueueItem). The
 * source assignment's client_contracts.created_draft_contract_id link is nulled by the renewal queue
 * job on every cycle change, so it cannot tell a later sync that a contract is a renewal. Prepaid Block
 * lines use the marker to issue their first block as a `renewal` (never `contract_start`).
 *
 * Plain nullable uuid, no FK: the source may be deleted without affecting the renewal contract.
 * Transaction-free like the other prepaid block migrations (distributed-table DDL). Back-fills
 * drafts that are still linked from their source assignment.
 */
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('contracts', 'renewal_of_contract_id'))) {
    await knex.schema.alterTable('contracts', (table) => {
      table.uuid('renewal_of_contract_id').nullable();
    });
  }
  // migration-lint: allow 5 - retroactive: one-shot backfill joined on tenant, merged before the lint existed; contracts is a low-volume table so no loop+LIMIT batching was added
  await knex.raw(`
    UPDATE contracts c
       SET renewal_of_contract_id = cc.contract_id
      FROM client_contracts cc
     WHERE cc.tenant = c.tenant
       AND cc.created_draft_contract_id = c.contract_id
       AND c.renewal_of_contract_id IS NULL
  `);
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('contracts', 'renewal_of_contract_id')) {
    await knex.schema.alterTable('contracts', (table) => {
      table.dropColumn('renewal_of_contract_id');
    });
  }
};
