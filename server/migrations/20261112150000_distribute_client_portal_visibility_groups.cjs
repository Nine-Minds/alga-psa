'use strict';
const { distributeLocalTenantTables } = require('./utils/citusDistribution.cjs');

// The client portal visibility group tables were never distributed, so
// resolving a contact's visible boards joins a coordinator-local table to the
// distributed boards — a recursively planned subplan shipped over a loopback
// connection, which fails client portal ticket access whenever the coordinator
// is near max_connections. Their keys already lead with tenant; co-locate
// them with clients.

exports.up = async function up(knex) {
  await distributeLocalTenantTables(knex, {
    // The board memberships reference the groups, so the groups go first.
    tables: ['client_portal_visibility_groups', 'client_portal_visibility_group_boards'],
    colocateWith: 'clients',
    // A group's link to a board that no longer exists grants nothing.
    removeOrphans: { client_portal_visibility_group_boards: ['board_id'] },
  });
};

// Forward-only: undistribute_table() would have to cascade through clients.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
