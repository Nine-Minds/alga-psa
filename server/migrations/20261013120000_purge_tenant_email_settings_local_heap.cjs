/**
 * Historical migration identity retained for databases that recorded this
 * filename. The purge moved to 20261104120000 so fresh installs and upgrades
 * use a current timestamp without invalidating existing Knex migration history.
 */
exports.up = async function up(_knex) {};

exports.down = async function down(_knex) {
  // No data changes are made by this historical migration identity.
};
