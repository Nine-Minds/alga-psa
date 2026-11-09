/** Validate the identity bindings after the resumable legacy backfill. */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE asset_tag_claims VALIDATE CONSTRAINT asset_tag_claims_owner_kind_check');
  await knex.raw('ALTER TABLE asset_tag_claims VALIDATE CONSTRAINT asset_tag_claims_reservation_owner_ck');
  await knex.raw('ALTER TABLE assets VALIDATE CONSTRAINT assets_nonblank_claim_ck');
  await knex.raw('ALTER TABLE assets VALIDATE CONSTRAINT assets_tag_write_policy_fk');
  await knex.raw('ALTER TABLE assets VALIDATE CONSTRAINT assets_tag_claim_fk');
  await knex.raw('ALTER TABLE assets VALIDATE CONSTRAINT assets_tag_legacy_binding_fk');
  await knex.raw('ALTER TABLE asset_number_reservations VALIDATE CONSTRAINT asset_number_reservations_tag_ck');
  await knex.raw('ALTER TABLE asset_number_reservations VALIDATE CONSTRAINT asset_number_reservations_state_ck');
  await knex.raw('ALTER TABLE asset_number_reservations VALIDATE CONSTRAINT asset_number_reservations_claim_fk');
};

exports.down = async function down() {};
exports.config = { transaction: false };
