// Shared helper for the dev seeds (not a seed itself).
//
// Uses the migration tenantDb shim rather than @alga-psa/db so seeds run in
// environments that don't build the workspace package (the integration test
// harness runs knex seed.run() directly) — same reason the migrations use it,
// see server/migrations/utils/tenantDb.cjs.
const { tenantDb } = require('../../migrations/utils/tenantDb.cjs');

function getTenantDb(knex, tenantId) {
  return tenantDb(knex, tenantId);
}

async function getFirstTenantId(knex, options = {}) {
  const query = knex('tenants').select('tenant');

  if (options.productCode) {
    query.where({ product_code: options.productCode });
  }

  const row = await query.first();
  return row?.tenant ?? null;
}

async function getFirstTenantSeedContext(knex, options = {}) {
  const tenantId = await getFirstTenantId(knex, options);

  if (!tenantId) {
    if (options.skipMessage) {
      console.warn(options.skipMessage);
    }
    return null;
  }

  return {
    tenantId,
    db: getTenantDb(knex, tenantId),
  };
}

// No-op seed: this is a helper module, but knex's directory-wide seed.run()
// loads every file here and requires each to export a `seed` function.
async function seed() {}

module.exports = {
  getFirstTenantId,
  getFirstTenantSeedContext,
  getTenantDb,
  seed,
};
