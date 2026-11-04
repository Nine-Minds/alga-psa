import type { Knex } from 'knex';
import { v5 } from 'uuid';
import { tenantDb } from './tenantDb';

/** Seed an ordinary editable catalog service; never rewrite historical invoice rows. */
export async function ensureMiscellaneousService(knex: Knex, tenant: string): Promise<string> {
  const db = tenantDb(knex, tenant);
  const serviceId = v5(`${tenant}:manual-charge-service`, v5.DNS);
  const existing = await db.table('service_catalog').where({ service_id: serviceId }).first('service_id');
  if (existing) return serviceId;
  await db.table('service_types').insert({ tenant, id: v5(`${tenant}:manual-charge-type`, v5.DNS),
    name: 'One-time charges', is_active: true,
  }).onConflict(['tenant', 'name']).ignore();
  const type = await db.table('service_types').where({ name: 'One-time charges' }).first('id');
  await db.table('service_catalog').insert({ tenant, service_id: serviceId,
    service_name: 'Miscellaneous / One-time charge', description: 'One-time invoice charges',
    custom_service_type_id: type.id, billing_method: 'fixed', default_rate: 0, unit_of_measure: 'each',
  }).onConflict(['tenant', 'service_id']).ignore();
  return serviceId;
}
