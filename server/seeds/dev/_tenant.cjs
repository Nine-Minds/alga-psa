async function getTenantDb(knex, tenantId) {
  const { tenantDb } = await import('@alga-psa/db');
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
    db: await getTenantDb(knex, tenantId),
  };
}

module.exports = {
  getFirstTenantId,
  getFirstTenantSeedContext,
  getTenantDb,
};
