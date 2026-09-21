/** Apply only to explicitly co-managed tenants, including appliance seed replay. */
exports.forCoManagedTenants = async function (knex, tenantId, apply) {
  let query = knex('tenants').where('product_code', 'co_managed');
  if (tenantId) query = query.where('tenant', tenantId);
  const tenants = await query.select('tenant');
  if (tenantId && !tenants.length) throw new Error('Co-managed seeds require a co-managed customer workspace');
  for (const { tenant } of tenants) await apply(tenant);
};
