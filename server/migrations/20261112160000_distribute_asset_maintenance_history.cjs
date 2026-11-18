'use strict';
const { distributeLocalTenantTables } = require('./utils/citusDistribution.cjs');

// asset_maintenance_history was never distributed, so the maintenance
// occurrence list and the client portal activity feed join a coordinator-local
// table to the distributed assets — a recursively planned subplan shipped over
// a loopback connection, which fails whenever the coordinator is near
// max_connections. Its key already leads with tenant; co-locate it with assets.

exports.up = async function up(knex) {
  await distributeLocalTenantTables(knex, {
    tables: ['asset_maintenance_history'],
    colocateWith: 'assets',
  });
};

// Forward-only: undistribute_table() would have to cascade through assets.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
