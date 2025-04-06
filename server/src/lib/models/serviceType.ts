import { Knex } from 'knex';
import { createTenantKnex } from '../db';
import { IServiceType, IStandardServiceType } from '../../interfaces/billing.interfaces'; // Ensure IStandardServiceType is imported
import { TenantEntity } from '../../interfaces'; 

const TABLE_NAME = 'service_types';

// Helper function to ensure tenant context
async function getTenantContext(tenantFromKnex?: string | null): Promise<string> {
  const tenant = tenantFromKnex; 
  if (!tenant) {
    throw new Error('Tenant context is required for this operation.');
  }
  return tenant;
}

export const ServiceTypeModel = {
  async findAll(tenantOverride?: string): Promise<IServiceType[]> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);
    return knex(TABLE_NAME).where({ tenant_id: tenant }).select('*');
  },

  async findActive(tenantOverride?: string): Promise<IServiceType[]> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);
    return knex(TABLE_NAME).where({ tenant_id: tenant, is_active: true }).select('*');
  },

  async findById(id: string, tenantOverride?: string): Promise<IServiceType | undefined> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);
    return knex(TABLE_NAME).where({ id, tenant_id: tenant }).first();
  },

  async findByName(name: string, tenantOverride?: string): Promise<IServiceType | undefined> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);
    return knex(TABLE_NAME).where({ name, tenant_id: tenant }).first();
  },

  async create(data: Omit<IServiceType, 'id' | 'created_at' | 'updated_at' | 'tenant'> & Partial<TenantEntity>): Promise<IServiceType> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = data.tenant ?? await getTenantContext(tenantFromKnex);
    
    const dataToInsert = {
      ...data,
      tenant_id: tenant,
    };
    delete dataToInsert.tenant; 

    const [newRecord] = await knex(TABLE_NAME).insert(dataToInsert).returning('*');
    return newRecord;
  },

  async update(id: string, data: Partial<Omit<IServiceType, 'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'tenant'>>, tenantOverride?: string): Promise<IServiceType | undefined> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);
    
    const [updatedRecord] = await knex(TABLE_NAME)
      .where({ id, tenant_id: tenant })
      .update({ ...data, updated_at: new Date() }) 
      .returning('*');
    return updatedRecord;
  },

  async delete(id: string, tenantOverride?: string): Promise<boolean> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);
    const deletedCount = await knex(TABLE_NAME).where({ id, tenant_id: tenant }).del();
    return deletedCount > 0;
  },

  // Find service types including standard ones (useful for dropdowns) - CORRECTED LOGIC
  // Find service types including standard ones (useful for dropdowns) - REVISED for simplified model
  async findAllIncludingStandard(tenantOverride?: string): Promise<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);

    // 1. Fetch all standard types
    const standardTypes = await knex('standard_service_types')
      .select('id', 'name', 'billing_method')
      .then(types => types.map(st => ({ ...st, is_standard: true })));

    // 2. Fetch all active tenant-specific custom types
    const customTypes = await knex<IServiceType>(TABLE_NAME)
      .where('tenant_id', tenant)
      .andWhere('is_active', true)
      .select('id', 'name', 'billing_method')
      .then(types => types.map(ct => ({ ...ct, is_standard: false })));

    // 3. Combine the lists
    const combinedTypes = [...standardTypes, ...customTypes];

    // 4. Sort alphabetically by name
    combinedTypes.sort((a, b) => a.name.localeCompare(b.name));

    // Ensure the return type matches the promise signature
    return combinedTypes as { id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[];
  }
};