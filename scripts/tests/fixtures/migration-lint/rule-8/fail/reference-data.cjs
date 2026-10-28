// Rule 8 (red): writes to global reference data and permission-catalog sync calls.
const { reconcileAllTenants } = require('../../../../server/src/lib/permissions');

exports.up = async function (knex) {
  // lint-expect: 8
  await knex.raw(`INSERT INTO permissions (resource, action) VALUES ('ticket_template', 'read')`);
  // lint-expect: 8
  await knex('role_permissions').insert({ role_id: 1 });
  // lint-expect: 8
  await reconcileAllTenants(knex);
};
