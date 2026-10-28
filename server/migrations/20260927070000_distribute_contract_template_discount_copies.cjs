'use strict';

// Also repair installations that already ran the initial copy-ledger migration.
exports.up = async function up(knex) {
  await require('./20260927050000_track_contract_template_discount_copies.cjs').up(knex);
};

exports.down = async function down() {
  // Keep tenant colocation and copied-term identities on rollback.
};
