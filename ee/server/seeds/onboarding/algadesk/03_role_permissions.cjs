const { reconcileSeedTenants } = require('../../../../../server/migrations/utils/permissionCatalog.cjs');

exports.seed = async function seed(knex, tenantId) {
  await reconcileSeedTenants(knex, { tenantId, productCode: 'algadesk' });
};
