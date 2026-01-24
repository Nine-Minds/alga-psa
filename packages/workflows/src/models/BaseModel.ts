import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';

export abstract class BaseModel {
  /**
   * @deprecated Use methods that accept knex/trx parameter instead.
   * This method should only be called from within a withAuth context.
   */
  static async getKnex(): Promise<Knex> {
    const { knex } = await createTenantKnex();
    return knex;
  }

  /**
   * @deprecated Use methods that accept tenant parameter instead.
   * This method should only be called from within a withAuth context.
   */
  static async getTenant(): Promise<string | null> {
    const { tenant } = await createTenantKnex();
    return tenant;
  }
}

