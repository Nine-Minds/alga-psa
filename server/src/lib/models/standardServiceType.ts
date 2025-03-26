import { Knex } from 'knex';
import { createTenantKnex } from '../db'; // Correct import path and function
import { IStandardServiceType } from '../../interfaces/billing.interfaces';

const TABLE_NAME = 'standard_service_types';

// Note: Standard service types are global, not tenant-specific.
// Queries here do not need tenant filtering.

export const StandardServiceTypeModel = {
  async findAll(): Promise<IStandardServiceType[]> {
    const { knex } = await createTenantKnex(); // Get Knex instance
    return knex(TABLE_NAME).select('*');
  },

  async findById(id: string): Promise<IStandardServiceType | undefined> {
    const { knex } = await createTenantKnex();
    return knex(TABLE_NAME).where({ id }).first();
  },

  async findByName(name: string): Promise<IStandardServiceType | undefined> {
    const { knex } = await createTenantKnex();
    return knex(TABLE_NAME).where({ name }).first();
  },

  async create(data: Omit<IStandardServiceType, 'id' | 'created_at' | 'updated_at'>): Promise<IStandardServiceType> {
    const { knex } = await createTenantKnex();
    const [newRecord] = await knex(TABLE_NAME).insert(data).returning('*');
    return newRecord;
  },

  async update(id: string, data: Partial<Omit<IStandardServiceType, 'id' | 'created_at' | 'updated_at'>>): Promise<IStandardServiceType | undefined> {
    const { knex } = await createTenantKnex();
    const [updatedRecord] = await knex(TABLE_NAME)
      .where({ id })
      .update({ ...data, updated_at: new Date() }) // Manually update updated_at
      .returning('*');
    return updatedRecord;
  },

  async delete(id: string): Promise<boolean> {
    const { knex } = await createTenantKnex();
    const deletedCount = await knex(TABLE_NAME).where({ id }).del();
    return deletedCount > 0;
  },
};