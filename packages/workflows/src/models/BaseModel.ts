import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';

export abstract class BaseModel {
  /**
   * @deprecated Use methods that accept knex/trx parameter instead
   */
  static async getKnex(): Promise<Knex> {
    const { knex } = await createTenantKnex();
    return knex;
  }

  static async getTenant(): Promise<string | null> {
    const { tenant } = await createTenantKnex();
    return tenant;
  }
}

