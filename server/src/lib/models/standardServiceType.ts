import { Knex } from 'knex';
import { IStandardServiceType } from '../../interfaces/billing.interfaces';

const TABLE_NAME = 'standard_service_types';

// Note: Standard service types are global, not tenant-specific.
// Queries here do not need tenant filtering.

export const StandardServiceTypeModel = {
  async findAll(knexOrTrx: Knex | Knex.Transaction): Promise<IStandardServiceType[]> {
    return knexOrTrx(TABLE_NAME).select('*');
  },

  async findById(knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IStandardServiceType | undefined> {
    return knexOrTrx(TABLE_NAME).where({ id }).first();
  },

  async findByName(knexOrTrx: Knex | Knex.Transaction, name: string): Promise<IStandardServiceType | undefined> {
    return knexOrTrx(TABLE_NAME).where({ name }).first();
  },

  async create(knexOrTrx: Knex | Knex.Transaction, data: Omit<IStandardServiceType, 'id' | 'created_at' | 'updated_at'>): Promise<IStandardServiceType> {
    const [newRecord] = await knexOrTrx(TABLE_NAME).insert(data).returning('*');
    return newRecord;
  },

  async update(knexOrTrx: Knex | Knex.Transaction, id: string, data: Partial<Omit<IStandardServiceType, 'id' | 'created_at' | 'updated_at'>>): Promise<IStandardServiceType | undefined> {
    const [updatedRecord] = await knexOrTrx(TABLE_NAME)
      .where({ id })
      .update({ ...data, updated_at: new Date() }) // Manually update updated_at
      .returning('*');
    return updatedRecord;
  },

  async delete(knexOrTrx: Knex | Knex.Transaction, id: string): Promise<boolean> {
    const deletedCount = await knexOrTrx(TABLE_NAME).where({ id }).del();
    return deletedCount > 0;
  },
};