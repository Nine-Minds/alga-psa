const { reconcileAllTenants } = require('./utils/permissionCatalog.cjs');
exports.up = async (knex) => reconcileAllTenants(knex);
exports.down = async () => {};
