const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');
exports.up = async function (knex) {
  for (const product of ['psa', 'co_managed']) {
    await reconcileAllTenants(knex, { product, label: 'co_management_permissions' });
  }
};
exports.down = async function () {
  throw new Error('Co-management permissions may be assigned to custom roles; retire them through a separate reviewed migration');
};
exports.config = { transaction: false };
