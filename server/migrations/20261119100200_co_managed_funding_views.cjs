// Edition seam for shared authorization and capability queries. EE supplies the rows.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE co_managed_purchase_operations ADD COLUMN IF NOT EXISTS trial_id uuid');
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_sponsors AS
    SELECT NULL::uuid AS tenant, NULL::timestamptz AS base_until, NULL::text AS status WHERE false`);
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_funding AS
    SELECT tenant, allocation_id FROM co_managed_allocations WHERE funding_source = 'seat_trial'`);
  // The shared ticket journal has one edition-independent call. CE has no pilot work to record.
  await knex.raw(`CREATE OR REPLACE FUNCTION record_co_managed_trial_ticket_work(uuid, uuid) RETURNS void
    LANGUAGE sql AS 'SELECT NULL::void'`);
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_access AS
    SELECT NULL::uuid AS tenant, NULL::uuid AS allocation_id, NULL::uuid AS assignment_id WHERE false`);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('co_managed_purchase_operations', table => table.dropColumn('trial_id'));
  await knex.raw('DROP FUNCTION IF EXISTS record_co_managed_trial_ticket_work(uuid, uuid)');
  await knex.raw('DROP VIEW co_managed_trial_funding, co_managed_trial_access, co_managed_trial_sponsors');
};
