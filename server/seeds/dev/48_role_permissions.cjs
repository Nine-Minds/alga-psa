const { reconcileSeedTenants } = require('../../migrations/utils/permissionCatalog.cjs');

exports.seed = async function seed(knex) {
  await reconcileSeedTenants(knex, { firstOnly: true });
};
