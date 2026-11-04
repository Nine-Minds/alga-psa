const { v4: uuidv4 } = require('uuid');
const { forCoManagedTenants } = require('../lib/coManagedSeeds.cjs');

/** Supply project defaults before the workspace's first administrator exists. */
exports.seed = (knex, tenantId) => forCoManagedTenants(knex, tenantId, async tenant => {
  const existing = await knex('statuses').where({ tenant }).where(function () {
    this.where('status_type', 'project').orWhere('item_type', 'project');
  }).first();
  // Seed replay must preserve the customer's configured status set.
  if (existing) return;

  const defaults = [
    ['Not Started', false],
    ['In Progress', false],
    ['On Hold', false],
    ['Completed', true],
    ['Cancelled', true],
  ];
  await knex('statuses').insert(defaults.map(([name, isClosed], index) => ({
    tenant,
    status_id: uuidv4(),
    name,
    status_type: 'project',
    item_type: 'project',
    order_number: (index + 1) * 10,
    is_closed: isClosed,
    is_default: index === 0,
    created_by: null,
    created_at: knex.fn.now(),
  })));
});
