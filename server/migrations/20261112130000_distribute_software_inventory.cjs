'use strict';
const { distributeLocalTenantTables } = require('./utils/citusDistribution.cjs');

// software_catalog and asset_software (20251130120002) were never distributed,
// so v_asset_software_details and the client software summary join two
// coordinator-local tables to the distributed assets and clients. Each such
// read is a recursively planned subplan shipped over a loopback connection —
// the asset Software tab and its counts fail whenever the coordinator is near
// max_connections. Both tables already lead every unique key with tenant;
// co-locate them with assets.

exports.up = async function up(knex) {
  await distributeLocalTenantTables(knex, {
    // asset_software references software_catalog, so the catalog goes first.
    tables: ['software_catalog', 'asset_software'],
    colocateWith: 'assets',
    // The trigger only stamped updated_at; updateSoftwareCatalogEntry, the one
    // UPDATE of the catalog, sets it itself.
    dropTriggers: { software_catalog: ['set_timestamp_software_catalog'] },
  });
};

// Forward-only: undistribute_table() would have to cascade through assets.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
