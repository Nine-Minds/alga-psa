import { createTenantKnex } from '../lib/db';
import { Knex } from 'knex';

export abstract class BaseModel {
  /**
   * @deprecated Use methods that accept knex/trx parameter instead
   */
  static async getKnex(): Promise<Knex> {
    const { knex } = await createTenantKnex();
    return knex;
  }

  /**
   * Helper to get tenant ID from the current context
   */
  static async getTenant(): Promise<string | null> {
    const { tenant } = await createTenantKnex();
    return tenant;
  }
}