const { v5 } = require('uuid');

// Deterministic identities make retries safe without renaming edited catalog data.
exports.up = async function(knex) {
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    await exports.seedTenant(knex, tenant);
  }
};
exports.seedTenant = async function(knex, tenant) {
  const serviceId = v5(`${tenant}:manual-charge-service`, v5.DNS);
  if (await knex('service_catalog').where({ tenant, service_id: serviceId }).first('service_id')) return;
  const typeId = v5(`${tenant}:manual-charge-type`, v5.DNS);
  await knex('service_types').insert({ tenant, id: typeId, name: 'One-time charges', is_active: true })
    .onConflict(['tenant', 'name']).ignore();
  const type = await knex('service_types').where({ tenant, name: 'One-time charges' }).first('id');
  await knex('service_catalog').insert({ tenant, service_id: serviceId,
    service_name: 'Miscellaneous / One-time charge', description: 'One-time invoice charges',
    custom_service_type_id: type.id, billing_method: 'fixed', default_rate: 0, unit_of_measure: 'each',
  }).onConflict(['tenant', 'service_id']).ignore();
};
// Catalog rows may now be referenced by invoices. Rollback must preserve them.
exports.down = async function() {};
