import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import type { Knex } from 'knex';

export abstract class BaseModel {
  /**
   * @deprecated Use methods that accept knex/trx parameter instead
   */
  static async getKnex(): Promise<Knex> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }
    const { knex } = await createTenantKnex(currentUser.tenant);
    return knex;
  }

  static async getTenant(): Promise<string | null> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }
    const { tenant } = await createTenantKnex(currentUser.tenant);
    return tenant;
  }
}

