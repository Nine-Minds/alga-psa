import { Knex } from 'knex';
import { getCurrentTenantId } from '../db';
import { IServiceType, IStandardServiceType } from '../../interfaces/billing.interfaces'; // Ensure IStandardServiceType is imported
import { TenantEntity } from '../../interfaces'; 

const TABLE_NAME = 'service_types';


export const ServiceTypeModel = {
  async findAll(knexOrTrx: Knex | Knex.Transaction): Promise<IServiceType[]> {
    const tenant = await getCurrentTenantId();
    return knexOrTrx(TABLE_NAME).where({ tenant }).select('*');
  },

  async findActive(knexOrTrx: Knex | Knex.Transaction): Promise<IServiceType[]> {
    const tenant = await getCurrentTenantId();
    return knexOrTrx(TABLE_NAME).where({ tenant, is_active: true }).select('*');
  },

  async findById(knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IServiceType | undefined> {
    const tenant = await getCurrentTenantId();
    return knexOrTrx(TABLE_NAME).where({ id, tenant }).first();
  },

  async findByName(knexOrTrx: Knex | Knex.Transaction, name: string): Promise<IServiceType | undefined> {
    const tenant = await getCurrentTenantId();
    return knexOrTrx(TABLE_NAME).where({ name, tenant }).first();
  },

  async create(knexOrTrx: Knex | Knex.Transaction, data: Omit<IServiceType, 'id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IServiceType> {
    const tenant = await getCurrentTenantId();
    
    const dataToInsert = {
      ...data,
      tenant,
    };

    const [newRecord] = await knexOrTrx(TABLE_NAME).insert(dataToInsert).returning('*');
    return newRecord;
  },

  async update(knexOrTrx: Knex | Knex.Transaction, id: string, data: Partial<Omit<IServiceType, 'id' | 'tenant' | 'created_at' | 'updated_at'>>): Promise<IServiceType | undefined> {
    const tenant = await getCurrentTenantId();
    
    const [updatedRecord] = await knexOrTrx(TABLE_NAME)
      .where({ id, tenant })
      .update({ ...data, updated_at: new Date() }) 
      .returning('*');
    return updatedRecord;
  },

  async delete(knexOrTrx: Knex | Knex.Transaction, id: string): Promise<boolean> {
    const tenant = await getCurrentTenantId();
    const deletedCount = await knexOrTrx(TABLE_NAME).where({ id, tenant }).del();
    return deletedCount > 0;
  },

  // Find all tenant-specific service types (only returns tenant-specific types, not standard ones)
  async findAllIncludingStandard(knexOrTrx: Knex | Knex.Transaction): Promise<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage'; is_standard: boolean }[]> {
    const tenant = await getCurrentTenantId();

    // Fetch all active tenant-specific service types
    const tenantTypes = await knexOrTrx<IServiceType>(TABLE_NAME)
      .where('tenant', tenant)
      .andWhere('is_active', true)
      .select('id', 'name', 'billing_method')
      .then(types => types.map(type => ({
        id: type.id,
        name: type.name,
        billing_method: type.billing_method,
        is_standard: false // All tenant-specific types are marked as non-standard
      })));

    // Sort alphabetically by name
    tenantTypes.sort((a, b) => a.name.localeCompare(b.name));

    // Ensure the return type matches the promise signature
    return tenantTypes as { id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage'; is_standard: boolean }[];
  }
};