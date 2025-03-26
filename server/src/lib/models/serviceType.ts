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
      standard_service_type_id: data.standard_service_type_id || null, // Ensure null if undefined
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
  async findAllIncludingStandard(tenantOverride?: string): Promise<(IServiceType & { is_standard?: boolean })[]> {
    const { knex, tenant: tenantFromKnex } = await createTenantKnex();
    const tenant = tenantOverride ?? await getTenantContext(tenantFromKnex);

    // 1. Fetch all standard types
    const standardTypesData: IStandardServiceType[] = await knex('standard_service_types').select('*');
    const standardTypeMap = new Map(standardTypesData.map(st => [st.id, st]));

    // 2. Fetch all active tenant types for the current tenant
    const tenantTypesData: IServiceType[] = await knex(TABLE_NAME)
        .where({ tenant_id: tenant, is_active: true })
        .select('*');

    // 3. Create a Set of standard_service_type_ids present in tenantTypesData
    const representedStandardIds = new Set(
        tenantTypesData
            .map(t => t.standard_service_type_id)
            .filter(id => id != null)
    );

    // 4. Build the result array
    // 4a. Map tenantTypesData, marking standard/custom based on standard_service_type_id
    const mappedTenantTypes = tenantTypesData.map(tt => ({
        ...tt,
        is_standard: tt.standard_service_type_id != null // True if linked to a standard type, false if custom
    }));

    // 4b. Filter standardTypesData to find those NOT represented in tenantTypesData
    const missingStandardTypes = standardTypesData.filter(std => !representedStandardIds.has(std.id));

    // 4c. Map the missing standard types to the IServiceType structure
    const mappedMissingStandardTypes = missingStandardTypes.map(std => ({
        // Synthesize IServiceType fields
        id: std.id, // Use standard ID for consistency in this fallback case
        tenant_id: tenant,
        name: std.name,
        standard_service_type_id: std.id,
        is_active: true, // Assume active
        description: null,
        created_at: std.created_at, // Use standard timestamps
        updated_at: std.updated_at,
        tenant: tenant, // Add tenant property from TenantEntity
        // Mark as standard
        is_standard: true 
    }));

    // 4d. Combine the lists
    const combinedTypes = [
        ...mappedTenantTypes,
        ...mappedMissingStandardTypes
    ];

    // 5. Sort alphabetically by name
    combinedTypes.sort((a, b) => a.name.localeCompare(b.name));

    return combinedTypes;
  }
};