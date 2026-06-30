import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IServiceType } from '@alga-psa/types';

const TABLE_NAME = 'service_types';

function tenantScopedTable<Row extends object = IServiceType>(
  conn: Knex | Knex.Transaction,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(TABLE_NAME);
}

export const ServiceTypeModel = {
  async findAll(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<IServiceType[]> {
    return tenantScopedTable(knexOrTrx, tenant).select('*');
  },

  async findActive(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<IServiceType[]> {
    return tenantScopedTable(knexOrTrx, tenant).where({ is_active: true }).select('*');
  },

  async findById(knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<IServiceType | undefined> {
    return tenantScopedTable(knexOrTrx, tenant).where({ id }).first();
  },

  async findByName(knexOrTrx: Knex | Knex.Transaction, tenant: string, name: string): Promise<IServiceType | undefined> {
    return tenantScopedTable(knexOrTrx, tenant).where({ name }).first();
  },

  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    data: Omit<IServiceType, 'id' | 'created_at' | 'updated_at' | 'tenant'>
  ): Promise<IServiceType> {
    const dataToInsert = {
      ...data,
      tenant,
    };

    const [newRecord] = await tenantScopedTable(knexOrTrx, tenant).insert(dataToInsert).returning('*');
    return newRecord;
  },

  async update(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string,
    data: Partial<Omit<IServiceType, 'id' | 'tenant' | 'created_at' | 'updated_at'>>
  ): Promise<IServiceType | undefined> {
    const [updatedRecord] = await tenantScopedTable(knexOrTrx, tenant)
      .where({ id })
      .update({ ...data, updated_at: new Date() as any })
      .returning('*');
    return updatedRecord;
  },

  async delete(knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<boolean> {
    const deletedCount = await tenantScopedTable(knexOrTrx, tenant).where({ id }).del();
    return deletedCount > 0;
  },

  // Find all tenant-specific service types (only returns tenant-specific types, not standard ones)
  async findAllIncludingStandard(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<{ id: string; name: string; is_standard: boolean }[]> {
    // Fetch all active tenant-specific service types
    const tenantTypes = await tenantScopedTable(knexOrTrx, tenant)
      .where('is_active', true)
      .select('id', 'name')
      .then(types => types.map(type => ({
        id: type.id,
        name: type.name,
        is_standard: false // All tenant-specific types are marked as non-standard
      })));

    // Sort alphabetically by name
    tenantTypes.sort((a, b) => a.name.localeCompare(b.name));

    // Ensure the return type matches the promise signature
    return tenantTypes as { id: string; name: string; is_standard: boolean }[];
  }
};
