// Edition seam for shared authorization and capability queries. EE supplies the rows.
exports.up = async function (knex) {
  await knex.schema.alterTable('co_managed_purchase_operations', table => table.uuid('trial_id'));
  await knex.raw(`CREATE VIEW co_managed_trial_sponsors AS
    SELECT NULL::uuid AS tenant, NULL::timestamptz AS base_until, NULL::text AS status WHERE false`);
  await knex.raw(`CREATE VIEW co_managed_trial_access AS
    SELECT NULL::uuid AS tenant, NULL::uuid AS allocation_id, NULL::uuid AS assignment_id WHERE false`);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('co_managed_purchase_operations', table => table.dropColumn('trial_id'));
  await knex.raw('DROP VIEW co_managed_trial_access, co_managed_trial_sponsors');
};
